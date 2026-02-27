import { db, auth } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { 
    collection, addDoc, getDocs, doc, updateDoc, deleteDoc, query, orderBy, serverTimestamp, increment 
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

let dbState = { fornecedores: {}, produtos: {}, enderecos: [], volumes: [] };

onAuthStateChanged(auth, user => {
    if (user) {
        document.getElementById("labelUser").innerText = `Olá, ${user.email.split('@')[0].toUpperCase()}`;
        loadAll();
    } else { window.location.href = "index.html"; }
});

async function loadAll() {
    // 1. Carrega Mapas de apoio (Fornecedores e Produtos)
    const fSnap = await getDocs(collection(db, "fornecedores"));
    fSnap.forEach(d => dbState.fornecedores[d.id] = d.data().nome);

    const pSnap = await getDocs(collection(db, "produtos"));
    pSnap.forEach(d => {
        const p = d.data();
        dbState.produtos[d.id] = { nome: p.nome, forn: dbState.fornecedores[p.fornecedorId] || "---" };
    });

    syncUI();
}

async function syncUI() {
    // 2. Carrega Endereços e Volumes em tempo real (após ações)
    const eSnap = await getDocs(query(collection(db, "enderecos"), orderBy("rua"), orderBy("modulo")));
    const vSnap = await getDocs(collection(db, "volumes"));
    
    dbState.enderecos = eSnap.docs.map(d => ({id: d.id, ...d.data()}));
    dbState.volumes = vSnap.docs.map(d => ({id: d.id, ...d.data()}));

    renderPendentes();
    renderEnderecos();
}

function renderPendentes() {
    const lista = document.getElementById("listaPendentes");
    lista.innerHTML = "";
    
    dbState.volumes.forEach(v => {
        // Se tem quantidade e NÃO tem endereçoId, está pendente
        if (v.quantidade > 0 && (!v.enderecoId || v.enderecoId === "")) {
            const p = dbState.produtos[v.produtoId] || { nome: "Produto Excluído", forn: "---" };
            lista.innerHTML += `
                <div class="card-pendente" style="border-left: 5px solid var(--danger); padding: 10px; background: white; margin-bottom: 8px; border-radius: 4px; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
                    <div style="font-size: 10px; color: var(--primary); font-weight: bold; text-transform: uppercase;">${p.forn}</div>
                    <div style="font-size: 13px; font-weight: bold; margin: 3px 0;">${v.descricao}</div>
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <span>Qtd: <b>${v.quantidade}</b></span>
                        <button onclick="window.abrirModalMover('${v.id}')" style="background: var(--success); color: white; border: none; padding: 5px 10px; border-radius: 3px; cursor: pointer; font-size: 11px;">GUARDAR</button>
                    </div>
                </div>
            `;
        }
    });
}

function renderEnderecos() {
    const grid = document.getElementById("gridEnderecos");
    grid.innerHTML = "";

    dbState.enderecos.forEach(end => {
        const volsNesteLocal = dbState.volumes.filter(v => v.enderecoId === end.id && v.quantidade > 0);
        
        grid.innerHTML += `
            <div style="background: white; border: 1px solid #ddd; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 5px rgba(0,0,0,0.05);">
                <div style="background: var(--secondary); color: white; padding: 10px; font-weight: bold; display: flex; justify-content: space-between; align-items: center;">
                    <span>RUA ${end.rua} - MOD ${end.modulo} ${end.nivel ? '- NV '+end.nivel : ''}</span>
                    <i class="fas fa-trash" onclick="window.deletarLocal('${end.id}')" style="cursor:pointer; font-size: 12px; opacity: 0.7;"></i>
                </div>
                <div style="padding: 10px; min-height: 50px;">
                    ${volsNesteLocal.map(v => `
                        <div style="background: #fdfdfd; border-bottom: 1px solid #eee; padding: 8px 0; margin-bottom: 5px;">
                            <div style="font-size: 12px;"><b>${v.quantidade}x</b> ${v.descricao}</div>
                            <div style="display: flex; gap: 5px; margin-top: 5px;">
                                <button onclick="window.abrirModalMover('${v.id}')" style="flex:1; font-size: 10px; padding: 3px; cursor:pointer; background:#eee; border:1px solid #ccc;">MOVER</button>
                                <button onclick="window.darSaida('${v.id}', '${v.descricao}')" style="flex:1; font-size: 10px; padding: 3px; color: white; background: var(--danger); border:none; border-radius:3px; cursor:pointer;">SAÍDA</button>
                            </div>
                        </div>
                    `).join('') || '<div style="color: #ccc; font-size: 11px; text-align: center; padding: 10px;">Vazio</div>'}
                </div>
            </div>
        `;
    });
}

// --- MODAL DE ENDEREÇAMENTO ---
window.abrirModalMover = (volId) => {
    const vol = dbState.volumes.find(v => v.id === volId);
    const modal = document.getElementById("modalMaster");
    const body = document.getElementById("modalBody");

    // Monta a lista de endereços cadastrados no Select
    let options = dbState.enderecos.map(e => `
        <option value="${e.id}">RUA ${e.rua} - MOD ${e.modulo} ${e.nivel ? '(Nível '+e.nivel+')' : ''}</option>
    `).join('');

    body.innerHTML = `
        <p style="font-size:13px; margin-bottom:15px;">Mover <b>${vol.descricao}</b> para:</p>
        <select id="selectDestino" style="width: 100%; padding: 10px; border-radius: 4px; border: 1px solid #ccc; margin-bottom:15px;">
            <option value="">Selecione o endereço...</option>
            ${options}
        </select>
        <label style="font-size:12px; font-weight:bold;">Quantidade:</label>
        <input type="number" id="qtdMover" value="${vol.quantidade}" max="${vol.quantidade}" min="1" style="width: 93%; padding: 10px; border-radius: 4px; border: 1px solid #ccc;">
    `;

    modal.style.display = "flex";

    document.getElementById("btnConfirmar").onclick = async () => {
        const destId = document.getElementById("selectDestino").value;
        const qtd = parseInt(document.getElementById("qtdMover").value);

        if (!destId) return alert("Selecione um local!");
        if (qtd <= 0 || qtd > vol.quantidade) return alert("Quantidade inválida!");

        await processarTransferencia(volId, destId, qtd);
    };
};

async function processarTransferencia(volIdOrigem, endIdDestino, qtd) {
    const volOrigem = dbState.volumes.find(v => v.id === volIdOrigem);
    const endDestino = dbState.enderecos.find(e => e.id === endIdDestino);
    
    // Procura se já existe esse MESMO volume (mesmo produto e mesma descrição) no destino
    const volNoDestino = dbState.volumes.find(v => 
        v.enderecoId === endIdDestino && 
        v.produtoId === volOrigem.produtoId && 
        v.descricao === volOrigem.descricao
    );

    // Se estiver movendo a quantidade TOTAL
    if (qtd === volOrigem.quantidade) {
        if (volNoDestino) {
            // Soma no que já existe lá e apaga o registro de origem
            await updateDoc(doc(db, "volumes", volNoDestino.id), { quantidade: increment(qtd) });
            await deleteDoc(doc(db, "volumes", volIdOrigem));
        } else {
            // Apenas atualiza o endereço do registro atual
            await updateDoc(doc(db, "volumes", volIdOrigem), { enderecoId: endIdDestino });
        }
    } else {
        // Se for parcial: diminui na origem e cria/soma no destino
        await updateDoc(doc(db, "volumes", volIdOrigem), { quantidade: increment(-qtd) });
        if (volNoDestino) {
            await updateDoc(doc(db, "volumes", volNoDestino.id), { quantidade: increment(qtd) });
        } else {
            await addDoc(collection(db, "volumes"), {
                produtoId: volOrigem.produtoId,
                descricao: volOrigem.descricao,
                quantidade: qtd,
                enderecoId: endIdDestino,
                ultimaMovimentacao: serverTimestamp()
            });
        }
    }

    // Registra Histórico
    await addDoc(collection(db, "movimentacoes"), {
        produto: volOrigem.descricao,
        tipo: "Logística",
        quantidade: qtd,
        usuario: auth.currentUser.email,
        data: serverTimestamp(),
        detalhe: `Movido para RUA ${endDestino.rua} MOD ${endDestino.modulo}`
    });

    window.fecharModal();
    syncUI();
}

// --- FUNÇÕES DE ESTRUTURA (CRIAR E DELETAR ENDEREÇOS) ---

document.getElementById("btnCriarEndereco").onclick = async () => {
    const rua = document.getElementById("addRua").value.toUpperCase();
    const mod = document.getElementById("addModulo").value;
    const niv = document.getElementById("addNivel").value;

    if (!rua || !mod) return alert("Rua e Módulo são obrigatórios!");

    await addDoc(collection(db, "enderecos"), { rua, modulo: mod, nivel: niv, data: serverTimestamp() });
    
    await addDoc(collection(db, "movimentacoes"), {
        produto: `Novo Endereço: RUA ${rua} MOD ${mod}`,
        tipo: "Estrutura", quantidade: 0, usuario: auth.currentUser.email, data: serverTimestamp()
    });

    document.getElementById("addRua").value = "";
    document.getElementById("addModulo").value = "";
    document.getElementById("addNivel").value = "";
    syncUI();
};

window.deletarLocal = async (id) => {
    if (confirm("Ao excluir este endereço, os itens nele voltarão para 'Não Endereçados'. Continuar?")) {
        const afetados = dbState.volumes.filter(v => v.enderecoId === id);
        for (let v of afetados) {
            await updateDoc(doc(db, "volumes", v.id), { enderecoId: "" });
        }
        await deleteDoc(doc(db, "enderecos", id));
        syncUI();
    }
};

window.darSaida = async (volId, desc) => {
    const q = prompt(`Baixa de estoque: ${desc}\nQuantidade que saiu:`, "1");
    if (q && parseInt(q) > 0) {
        await updateDoc(doc(db, "volumes", volId), { quantidade: increment(-parseInt(q)) });
        await addDoc(collection(db, "movimentacoes"), {
            produto: desc, tipo: "Saída", quantidade: parseInt(q), usuario: auth.currentUser.email, data: serverTimestamp()
        });
        syncUI();
    }
};

window.fecharModal = () => { document.getElementById("modalMaster").style.display = "none"; };
window.logout = () => signOut(auth).then(() => window.location.href = "index.html");
