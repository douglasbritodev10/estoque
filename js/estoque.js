import { db, auth } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { 
    collection, addDoc, getDocs, doc, updateDoc, deleteDoc, query, serverTimestamp, increment 
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

let dbState = { fornecedores: {}, produtos: {}, enderecos: [], volumes: [] };

onAuthStateChanged(auth, user => {
    if (user) {
        document.getElementById("labelUser").innerText = `Olá, ${user.email.split('@')[0].toUpperCase()}`;
        loadAll();
    } else { window.location.href = "index.html"; }
});

async function loadAll() {
    try {
        // 1. Carrega Fornecedores e Produtos para os Mapas
        const fSnap = await getDocs(collection(db, "fornecedores"));
        fSnap.forEach(d => dbState.fornecedores[d.id] = d.data().nome);

        const pSnap = await getDocs(collection(db, "produtos"));
        pSnap.forEach(d => {
            const p = d.data();
            dbState.produtos[d.id] = { nome: p.nome, forn: dbState.fornecedores[p.fornecedorId] || "---" };
        });

        await syncUI();
    } catch (e) { console.error("Erro ao carregar banco:", e); }
}

async function syncUI() {
    // Busca Endereços e ordena no JS para evitar erro de Index no Firebase
    const eSnap = await getDocs(collection(db, "enderecos"));
    dbState.enderecos = eSnap.docs.map(d => ({id: d.id, ...d.data()}))
        .sort((a,b) => a.rua.localeCompare(b.rua) || a.modulo - b.modulo);

    const vSnap = await getDocs(collection(db, "volumes"));
    dbState.volumes = vSnap.docs.map(d => ({id: d.id, ...d.data()}));

    renderPendentes();
    renderCards();
}

function renderPendentes() {
    const container = document.getElementById("listaPendentes");
    container.innerHTML = "";
    
    dbState.volumes.forEach(v => {
        // Regra: Tem quantidade > 0 e não está em nenhum endereço
        if (v.quantidade > 0 && (!v.enderecoId || v.enderecoId === "")) {
            const p = dbState.produtos[v.produtoId] || {forn: '---'};
            const card = document.createElement("div");
            card.className = "card-pendente";
            card.innerHTML = `
                <div style="font-size:10px; font-weight:bold; color:var(--danger)">${p.forn.toUpperCase()}</div>
                <div style="font-size:13px; font-weight:600; margin:5px 0;">${v.descricao}</div>
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <span style="font-weight:900; color:#444">QTD: ${v.quantidade}</span>
                    <button onclick="window.abrirModalMover('${v.id}', 'vincular')" class="btn-action btn-success" style="padding:6px 12px; font-size:10px;">ENDEREÇAR</button>
                </div>
            `;
            container.appendChild(card);
        }
    });
}

function renderCards() {
    const grid = document.getElementById("gridEnderecos");
    grid.innerHTML = "";

    dbState.enderecos.forEach(end => {
        const volumesAqui = dbState.volumes.filter(v => v.enderecoId === end.id && v.quantidade > 0);
        
        const card = document.createElement("div");
        card.className = "card-endereco";
        card.innerHTML = `
            <div class="card-end-header">
                <span>RUA ${end.rua} - MOD ${end.modulo}</span>
                <button onclick="window.deletarLocal('${end.id}')" style="background:none; border:none; color:#ff9999; cursor:pointer;"><i class="fas fa-trash-alt"></i></button>
            </div>
            <div class="card-end-body">
                ${volumesAqui.map(v => {
                    const p = dbState.produtos[v.produtoId] || {forn: '---'};
                    return `
                    <div class="vol-item">
                        <div class="vol-item-forn">${p.forn}</div>
                        <div class="vol-item-desc"><b>${v.quantidade}x</b> ${v.descricao}</div>
                        <div class="vol-item-actions">
                            <button onclick="window.abrirModalMover('${v.id}', 'transferir')" class="btn-action btn-outline-warn" style="flex:1; padding:4px;"><i class="fas fa-exchange-alt"></i> MOVER</button>
                            <button onclick="window.abrirModalSaida('${v.id}')" class="btn-action btn-outline-danger" style="flex:1; padding:4px;"><i class="fas fa-sign-out-alt"></i> SAÍDA</button>
                        </div>
                    </div>`;
                }).join('') || '<div style="text-align:center; color:#adb5bd; font-size:12px; padding:15px">Vazio</div>'}
            </div>
        `;
        grid.appendChild(card);
    });
}

// --- LÓGICA DE MODAIS E MOVIMENTAÇÃO ---

window.abrirModalMover = (volId, modo) => {
    const vol = dbState.volumes.find(v => v.id === volId);
    document.getElementById("modalTitle").innerText = modo === 'vincular' ? "Vincular ao Endereço" : "Transferência de Volume";
    document.getElementById("modalBody").innerHTML = `
        <div style="background:var(--light); padding:12px; border-radius:8px; margin-bottom:15px; font-size:13px;">
            <b>Produto:</b> ${vol.descricao} <br>
            <b>Disponível:</b> ${vol.quantidade} unidades
        </div>
        <div class="field-group">
            <label>Quantidade a transferir:</label>
            <input type="number" id="inputQtd" value="${vol.quantidade}" min="1" max="${vol.quantidade}">
        </div>
        <div class="field-group" style="margin-top:10px;">
            <label>Endereço de Destino:</label>
            <select id="selectDestino">
                ${dbState.enderecos.filter(e => e.id !== vol.enderecoId).map(e => `<option value="${e.id}">RUA ${e.rua} | MOD ${e.modulo} | NIVEL ${e.nivel}</option>`).join('')}
            </select>
        </div>
    `;
    document.getElementById("modalMaster").style.display = "flex";
    document.getElementById("btnConfirmarModal").onclick = () => processarMover(volId, document.getElementById("selectDestino").value, parseInt(document.getElementById("inputQtd").value));
};

async function processarMover(volOrigemId, endDestinoId, qtd) {
    const volOrigem = dbState.volumes.find(v => v.id === volOrigemId);
    
    // Busca se já existe o mesmo produto no destino (Para agrupar)
    const volNoDestino = dbState.volumes.find(v => 
        v.enderecoId === endDestinoId && 
        v.produtoId === volOrigem.produtoId && 
        v.descricao === volOrigem.descricao
    );

    if (qtd >= volOrigem.quantidade) {
        // Mover TUDO
        if (volNoDestino) {
            await updateDoc(doc(db, "volumes", volNoDestino.id), { quantidade: increment(volOrigem.quantidade) });
            await deleteDoc(doc(db, "volumes", volOrigemId));
        } else {
            await updateDoc(doc(db, "volumes", volOrigemId), { enderecoId: endDestinoId });
        }
    } else {
        // Mover PARCIAL
        await updateDoc(doc(db, "volumes", volOrigemId), { quantidade: increment(-qtd) });
        if (volNoDestino) {
            await updateDoc(doc(db, "volumes", volNoDestino.id), { quantidade: increment(qtd) });
        } else {
            await addDoc(collection(db, "volumes"), {
                produtoId: volOrigem.produtoId,
                descricao: volOrigem.descricao,
                quantidade: qtd,
                enderecoId: endDestinoId,
                dataMov: serverTimestamp()
            });
        }
    }

    await registrarMov(`Movimentação: ${volOrigem.descricao}`, "Logística", qtd);
    fecharModal();
    syncUI();
}

window.abrirModalSaida = (volId) => {
    const vol = dbState.volumes.find(v => v.id === volId);
    document.getElementById("modalTitle").innerText = "Dar Saída do Local";
    document.getElementById("modalBody").innerHTML = `
        <div class="field-group">
            <label>Quantidade que saiu deste endereço:</label>
            <input type="number" id="inputQtdSaida" value="1" min="1" max="${vol.quantidade}">
        </div>
    `;
    document.getElementById("modalMaster").style.display = "flex";
    document.getElementById("btnConfirmarModal").onclick = async () => {
        const q = parseInt(document.getElementById("inputQtdSaida").value);
        await updateDoc(doc(db, "volumes", volId), { quantidade: increment(-q) });
        await registrarMov(`Saída (Endereçamento): ${vol.descricao}`, "Saída", q);
        fecharModal();
        syncUI();
    };
};

// Segurança: Deletar endereço desvincula volumes
window.deletarLocal = async (id) => {
    if(confirm("Ao excluir este endereço, todos os itens nele voltarão para 'NÃO ENDEREÇADOS'. Continuar?")){
        const afetados = dbState.volumes.filter(v => v.enderecoId === id);
        for(let v of afetados) {
            await updateDoc(doc(db, "volumes", v.id), { enderecoId: "" });
        }
        await deleteDoc(doc(db, "enderecos", id));
        syncUI();
    }
};

document.getElementById("btnCriarEndereco").onclick = async () => {
    const rua = document.getElementById("addRua").value.toUpperCase();
    const mod = document.getElementById("addModulo").value;
    const niv = document.getElementById("addNivel").value;
    if(!rua || !mod) return alert("Rua e Módulo obrigatórios!");

    await addDoc(collection(db, "enderecos"), { rua, modulo: mod, nivel: niv, data: serverTimestamp() });
    await registrarMov(`Novo Endereço: RUA ${rua} MOD ${mod}`, "Estrutura", 0);
    
    document.getElementById("addRua").value = ""; document.getElementById("addModulo").value = "";
    syncUI();
};

async function registrarMov(p, t, q) {
    await addDoc(collection(db, "movimentacoes"), {
        produto: p, tipo: t, quantidade: q, usuario: auth.currentUser.email, data: serverTimestamp()
    });
}

window.fecharModal = () => document.getElementById("modalMaster").style.display = "none";
window.logout = () => signOut(auth).then(() => window.location.href = "index.html");
