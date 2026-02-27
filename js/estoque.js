import { db, auth } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { 
    collection, addDoc, getDocs, doc, updateDoc, deleteDoc, query, orderBy, serverTimestamp, increment 
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

let cacheData = { fornecedores: {}, produtos: {}, enderecos: [], volumes: [] };

onAuthStateChanged(auth, user => {
    if (user) {
        document.getElementById("labelUser").innerText = `Olá, ${user.email.split('@')[0].toUpperCase()}`;
        loadAll();
    } else { window.location.href = "index.html"; }
});

async function loadAll() {
    const fSnap = await getDocs(collection(db, "fornecedores"));
    fSnap.forEach(d => cacheData.fornecedores[d.id] = d.data().nome);

    const pSnap = await getDocs(collection(db, "produtos"));
    pSnap.forEach(d => {
        const p = d.data();
        cacheData.produtos[d.id] = { nome: p.nome, forn: cacheData.fornecedores[p.fornecedorId] || "---" };
    });

    await refreshDisplay();
}

async function refreshDisplay() {
    const eSnap = await getDocs(query(collection(db, "enderecos"), orderBy("rua"), orderBy("modulo")));
    cacheData.enderecos = eSnap.docs.map(d => ({id: d.id, ...d.data()}));

    const vSnap = await getDocs(collection(db, "volumes"));
    cacheData.volumes = vSnap.docs.map(d => ({id: d.id, ...d.data()}));

    renderEnderecos();
    renderPendentes();
}

function renderEnderecos() {
    const grid = document.getElementById("gridEnderecos");
    grid.innerHTML = "";
    
    cacheData.enderecos.forEach(end => {
        const volumesNoLocal = cacheData.volumes.filter(v => v.enderecoId === end.id && v.quantidade > 0);

        const card = document.createElement("div");
        card.className = "card-endereco";
        card.innerHTML = `
            <div class="card-end-header">
                <span>RUA ${end.rua} - ${end.modulo} (Niv ${end.nivel})</span>
                <div style="display:flex; gap:10px;">
                    <button onclick="window.editarEndereco('${end.id}')" style="background:none; border:none; color:white; cursor:pointer;">✎</button>
                    <button onclick="window.deletarEndereco('${end.id}')" style="background:none; border:none; color:white; cursor:pointer;">✕</button>
                </div>
            </div>
            <div class="card-end-body">
                ${volumesNoLocal.map(v => {
                    const p = cacheData.produtos[v.produtoId] || { nome: "N/A", forn: "---" };
                    return `
                    <div class="vol-item">
                        <div style="font-weight:700; color:var(--primary); font-size:11px;">${p.forn}</div>
                        <div style="font-size:12px;">${v.descricao}</div>
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:5px;">
                            <span style="background:#e9ecef; padding:2px 8px; border-radius:4px; font-weight:700;">${v.quantidade} un</span>
                            <button class="btn-action" style="background:var(--warning); padding:4px 8px;" onclick="window.abrirModalTransferir('${v.id}', '${v.quantidade}')">Transferir</button>
                        </div>
                    </div>`;
                }).join('') || '<div style="text-align:center; color:#adb5bd; padding:20px;">Vazio</div>'}
            </div>
        `;
        grid.appendChild(card);
    });
}

function renderPendentes() {
    const lista = document.getElementById("listaPendentes");
    lista.innerHTML = "";
    
    cacheData.volumes.forEach(v => {
        if (v.quantidade > 0 && (!v.enderecoId || v.enderecoId === "")) {
            const p = cacheData.produtos[v.produtoId] || { nome: "N/A", forn: "---" };
            const div = document.createElement("div");
            div.className = "card-pendente";
            div.innerHTML = `
                <div style="font-weight:700; color:var(--danger)">${p.forn}</div>
                <div style="font-size:13px; margin:4px 0;">${v.descricao}</div>
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <span style="font-weight:700;">Qtd: ${v.quantidade}</span>
                    <button class="btn-action" style="background:var(--primary)" onclick="window.abrirModalVincular('${v.id}', '${v.quantidade}')">Endereçar</button>
                </div>
            `;
            lista.appendChild(div);
        }
    });
}

// LÓGICA DE MODAIS PROFISSIONAIS
window.abrirModalVincular = (volId, qtdMax) => {
    document.getElementById("modalTitle").innerText = "Vincular ao Endereço";
    document.getElementById("labelSelect").innerText = "Escolha o local de destino:";
    const sel = document.getElementById("selectDestino");
    sel.innerHTML = cacheData.enderecos.map(e => `<option value="${e.id}">RUA ${e.rua} | MOD ${e.modulo} | NIV ${e.nivel}</option>`).join('');
    
    document.getElementById("inputQtdAcao").max = qtdMax;
    document.getElementById("inputQtdAcao").value = qtdMax;
    document.getElementById("modalAcao").style.display = "flex";

    document.getElementById("btnConfirmarAcao").onclick = () => processarVinculacao(volId, sel.value, document.getElementById("inputQtdAcao").value);
};

window.abrirModalTransferir = (volId, qtdMax) => {
    document.getElementById("modalTitle").innerText = "Transferência Interna";
    const sel = document.getElementById("selectDestino");
    sel.innerHTML = cacheData.enderecos.map(e => `<option value="${e.id}">RUA ${e.rua} | MOD ${e.modulo} | NIV ${e.nivel}</option>`).join('');
    
    document.getElementById("modalAcao").style.display = "flex";
    document.getElementById("btnConfirmarAcao").onclick = () => processarTransferencia(volId, sel.value, document.getElementById("inputQtdAcao").value);
};

// PROCESSAMENTO E HISTÓRICO
async function processarVinculacao(volId, endId, qtd) {
    const volRef = doc(db, "volumes", volId);
    await updateDoc(volRef, { enderecoId: endId });
    
    // Registrar Histórico
    const volData = cacheData.volumes.find(v => v.id === volId);
    await addDoc(collection(db, "movimentacoes"), {
        produto: volData.descricao,
        tipo: "Endereçamento",
        quantidade: parseInt(qtd),
        usuario: auth.currentUser.email,
        data: serverTimestamp()
    });

    fecharModal();
    refreshDisplay();
}

async function processarTransferencia(volId, novoEndId, qtd) {
    const volData = cacheData.volumes.find(v => v.id === volId);
    
    // Lógica Profissional: Se transferir tudo, apenas muda o ID. Se parcial, cria novo ou soma no destino.
    // Para simplificar e manter a integridade, vamos atualizar o endereço deste volume específico.
    await updateDoc(doc(db, "volumes", volId), { enderecoId: novoEndId });

    await addDoc(collection(db, "movimentacoes"), {
        produto: `Transferência: ${volData.descricao}`,
        tipo: "Movimentação Interna",
        quantidade: parseInt(qtd),
        usuario: auth.currentUser.email,
        data: serverTimestamp()
    });

    fecharModal();
    refreshDisplay();
}

window.fecharModal = () => document.getElementById("modalAcao").style.display = "none";

document.getElementById("btnCriarEndereco").onclick = async () => {
    const rua = document.getElementById("addRua").value.toUpperCase();
    const modulo = document.getElementById("addModulo").value;
    const nivel = document.getElementById("addNivel").value;
    if(!rua || !modulo) return;

    await addDoc(collection(db, "enderecos"), { rua, modulo, nivel, dataCriacao: serverTimestamp() });
    
    // Histórico de Criação de Local
    await addDoc(collection(db, "movimentacoes"), {
        produto: `Novo Endereço: RUA ${rua} MOD ${modulo}`,
        tipo: "Estrutura", quantidade: 0, usuario: auth.currentUser.email, data: serverTimestamp()
    });

    refreshDisplay();
};

window.logout = () => signOut(auth).then(() => window.location.href = "index.html");
