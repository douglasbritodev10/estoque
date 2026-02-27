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
    // 1. Carrega Mapas de Fornecedores e Produtos
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
    // 2. Carrega Endereços e Volumes
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
        if (v.quantidade > 0 && (!v.enderecoId || v.enderecoId === "")) {
            const p = dbState.produtos[v.produtoId] || { nome: "Produto Excluído", forn: "---" };
            lista.innerHTML += `
                <div class="card-pendente" style="border-left: 5px solid var(--danger); padding: 10px; background: white; margin-bottom: 8px; border-radius: 4px; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
                    <div style="font-size: 10px; color: var(--primary); font-weight: bold;">${p.forn}</div>
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
                <div style="background: var(--primary); color: white; padding: 10px; font-weight: bold; display: flex; justify-content: space-between; align-items: center;">
                    <span>RUA ${end.rua} - MOD ${end.modulo}</span>
                    <i class="fas fa-trash" onclick="window.deletarEndereco('${end.id}', 'RUA ${end.rua} MOD ${end.modulo}')" style="cursor:pointer; font-size: 12px; opacity: 0.8;"></i>
                </div>
                <div style="padding: 10px; min-height: 60px;">
                    ${volsNesteLocal.map(v => `
                        <div style="background: #f8f9fa; border-bottom: 1px solid #eee; padding: 8px 5px; margin-bottom: 5px;">
                            <div style="font-size: 12px; font-weight: 500;"><b>${v.quantidade}x</b> ${v.descricao}</div>
                            <div style="display: flex; gap: 5px; margin-top: 5px;">
                                <button onclick="window.abrirModalMover('${v.id}')" style="flex:1; font-size: 10px; padding: 2px; cursor:pointer;">MOVER</button>
                                <button onclick="window.darSaida('${v.id}', '${v.descricao}')" style="flex:1; font-size: 10px; padding: 2px; color: var(--danger); cursor:pointer;">SAÍDA</button>
                            </div>
                        </div>
                    `).join('') || '<div style="color: #ccc; font-size: 11px; text-align: center; padding-top: 15px;">Vazio</div>'}
                </div>
            </div>
        `;
    });
}

// --- MODAL PROFISSIONAL COM LISTA SUSPENSA ---
window.abrirModalMover = (volId) => {
    const vol = dbState.volumes.find(v => v.id === volId);
    const modal = document.getElementById("modalMaster");
    const title = document.getElementById("modalTitle");
    const body = document.getElementById("modalBody");

    title.innerText = `Endereçar: ${vol.descricao}`;
    
    // Cria o Select com os endereços cadastrados
    let options = dbState.enderecos.map(e => `<option value="${e.id}">RUA ${e.rua} - MOD ${e.modulo} ${e.nivel ? '(Nív '+e.nivel+')' : ''}</option>`).join('');

    body.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 15px; padding: 10px 0;">
            <div>
                <label style="display: block; font-size: 12px; font-weight: bold; margin-bottom: 5px;">DESTINO:</label>
                <select id="selectDestino" style="width: 100%; padding: 10px; border-radius: 4px; border: 1px solid #ccc;">
                    <option value="">Selecione um local...</option>
                    ${options}
                </select>
            </div>
            <div>
                <label style="display: block; font-size: 12px; font-weight: bold; margin-bottom: 5px;">QUANTIDADE (Disponível: ${vol.quantidade}):</label>
                <input type="number" id="qtdMover" value="${vol.quantidade}" max="${vol.quantidade}" min="1" style="width: 93%; padding: 10px; border-radius: 4px; border: 1px solid #ccc;">
            </div>
        </div>
    `;

    modal.style.display = "flex";

    document.getElementById("btnConfirmar").onclick = async () => {
        const destId = document.getElementById("selectDestino").value;
        const qtd = parseInt(document.getElementById("qtdMover").value);

        if (!destId) return alert("Selecione um endereço!");
        if (qtd <= 0 || qtd > vol.quantidade) return alert("Quantidade inválida!");

        await processarMovimentacao(volId, destId, qtd);
    };
};

async function processarMovimentacao(volIdOrigem, endIdDestino, qtd) {
    const volOrigem = dbState.volumes.find(v => v.id === volIdOrigem);
    const localDestino = dbState.enderecos.find(e => e.id === endIdDestino);
    
    // Verifica se já existe o MESMO volume naquele endereço para somar
    const volNoDestino = dbState.volumes.find(v => v.enderecoId === endIdDestino && v.produtoId === volOrigem.produtoId && v.descricao === volOrigem.descricao);

    if (qtd >= volOrigem.quantidade) {
        // Move tudo
        if (volNoDestino) {
            await updateDoc(doc(db, "volumes", volNoDestino.id), { quantidade: increment(volOrigem.quantidade) });
            await deleteDoc(doc(db, "volumes", volIdOrigem));
        } else {
            await updateDoc(doc(db, "volumes", volIdOrigem), { enderecoId: endIdDestino });
        }
    } else {
        // Move parcial
        await updateDoc(doc(db, "volumes", volIdOrigem), { quantidade: increment(-qtd) });
        if (volNoDestino) {
            await updateDoc(doc(db, "volumes", volNoDestino.id), { quantidade: increment(qtd) });
        } else {
            await addDoc(collection(db, "volumes"), {
                produtoId: volOrigem.produtoId,
                descricao: volOrigem.descricao,
                quantidade: qtd,
                enderecoId: endIdDestino
            });
        }
    }

    // REGISTRO NA MOVIMENTAÇÃO
    await addDoc(collection(db, "movimentacoes"), {
        produto: volOrigem.descricao,
        tipo: "Logística",
        quantidade: qtd,
        usuario: auth.currentUser.email,
        data: serverTimestamp(),
        detalhe: `Movido para RUA ${localDestino.rua} MOD ${localDestino.modulo}`
    });

    window.fecharModal();
    syncUI();
}

// --- FUNÇÕES DE CADASTRO E ESTRUTURA ---

document.getElementById("btnCriarEndereco").onclick = async () => {
    const rua = document.getElementById("addRua").value.toUpperCase();
    const modulo = document.getElementById("addModulo").value;
    const nivel = document.getElementById("addNivel").value;

    if (!rua || !modulo) return alert("Preencha Rua e Módulo!");

    await addDoc(collection(db, "enderecos"), { rua, modulo, nivel, data: serverTimestamp() });
    
    await addDoc(collection(db, "movimentacoes"), {
        produto: `Novo Local: RUA ${rua} MOD ${modulo}`,
        tipo: "Estrutura",
        quantidade: 0,
        usuario: auth.currentUser.email,
        data: serverTimestamp()
    });

    document.getElementById("addRua").value = "";
    document.getElementById("addModulo").value = "";
    document.getElementById("addNivel").value = "";
    syncUI();
};

window.deletarEndereco = async (id, desc) => {
    if (confirm(`Excluir endereço ${desc}?\nVolumes nele voltarão para "Não Endereçados".`)) {
        // Antes de deletar, limpa o enderecoId dos volumes que estavam lá
        const volsAfetados = dbState.volumes.filter(v => v.enderecoId === id);
        for (let v of volsAfetados) {
            await updateDoc(doc(db, "volumes", v.id), { enderecoId: "" });
        }

        await deleteDoc(doc(db, "enderecos", id));

        await addDoc(collection(db, "movimentacoes"), {
            produto: `Excluiu Local: ${desc}`,
            tipo: "Estrutura",
            quantidade: 0,
            usuario: auth.currentUser.email,
            data: serverTimestamp()
        });
        syncUI();
    }
};

window.darSaida = async (volId, desc) => {
    const qtd = prompt(`Quantidade de SAÍDA para (${desc}):`, "1");
    if (qtd && parseInt(qtd) > 0) {
        await updateDoc(doc(db, "volumes", volId), { quantidade: increment(-parseInt(qtd)) });
        
        await addDoc(collection(db, "movimentacoes"), {
            produto: desc,
            tipo: "Saída",
            quantidade: parseInt(qtd),
            usuario: auth.currentUser.email,
            data: serverTimestamp()
        });
        syncUI();
    }
};

window.fecharModal = () => { document.getElementById("modalMaster").style.display = "none"; };
window.logout = () => signOut(auth).then(() => window.location.href = "index.html");
