import { db, auth } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { 
    collection, addDoc, getDocs, doc, updateDoc, deleteDoc, query, orderBy, serverTimestamp 
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

let dataCache = { fornecedores: {}, produtos: {}, enderecos: [], volumes: [] };

onAuthStateChanged(auth, user => {
    if (user) {
        document.getElementById("labelUser").innerText = `Olá, ${user.email.split('@')[0].toUpperCase()}`;
        loadAll();
    } else { window.location.href = "index.html"; }
});

async function loadAll() {
    // 1. Carregar Mapas
    const fSnap = await getDocs(collection(db, "fornecedores"));
    fSnap.forEach(d => dataCache.fornecedores[d.id] = d.data().nome);

    const pSnap = await getDocs(collection(db, "produtos"));
    pSnap.forEach(d => {
        const p = d.data();
        dataCache.produtos[d.id] = { nome: p.nome, forn: dataCache.fornecedores[p.fornecedorId] || "---" };
    });

    await renderizarTudo();
}

async function renderizarTudo() {
    const eSnap = await getDocs(query(collection(db, "enderecos"), orderBy("rua"), orderBy("modulo")));
    dataCache.enderecos = eSnap.docs.map(d => ({id: d.id, ...d.data()}));

    const vSnap = await getDocs(collection(db, "volumes"));
    dataCache.volumes = vSnap.docs.map(d => ({id: d.id, ...d.data()}));

    renderCards();
    renderPendentes();
}

function renderCards() {
    const grid = document.getElementById("gridEnderecos");
    grid.innerHTML = "";

    dataCache.enderecos.forEach(end => {
        const itens = dataCache.volumes.filter(v => v.enderecoId === end.id && v.quantidade > 0);

        const card = document.createElement("div");
        card.className = "card-endereco";
        card.innerHTML = `
            <div class="card-end-header">
                <span>RUA ${end.rua} - MOD ${end.modulo}</span>
                <button onclick="window.deletarLocal('${end.id}')" style="background:none; border:none; color:#ff9999; cursor:pointer;"><i class="fas fa-trash"></i></button>
            </div>
            <div class="card-end-body">
                ${itens.map(i => {
                    const p = dataCache.produtos[i.produtoId] || {nome:'', forn:''};
                    return `
                    <div class="vol-item">
                        <small>${p.forn}</small><br>
                        <b>${i.quantidade}x</b> ${i.descricao}
                        <button onclick="window.abrirTransferir('${i.id}', '${end.id}')" style="float:right; border:none; background:none; color:var(--warning); cursor:pointer;"><i class="fas fa-exchange-alt"></i></button>
                    </div>`;
                }).join('') || '<p style="color:#ccc; text-align:center">Vazio</p>'}
            </div>
        `;
        grid.appendChild(card);
    });
}

function renderPendentes() {
    const lista = document.getElementById("listaPendentes");
    lista.innerHTML = "";

    dataCache.volumes.forEach(v => {
        if (v.quantidade > 0 && (!v.enderecoId || v.enderecoId === "")) {
            const p = dataCache.produtos[v.produtoId] || {forn: '---'};
            const div = document.createElement("div");
            div.className = "card-pendente";
            div.innerHTML = `
                <small>${p.forn}</small>
                <div style="font-weight:bold; margin:5px 0;">${v.descricao}</div>
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <span>Qtd: ${v.quantidade}</span>
                    <button onclick="window.abrirVincular('${v.id}')" class="btn-action btn-success" style="padding:5px 10px; font-size:11px;">ENDEREÇAR</button>
                </div>
            `;
            lista.appendChild(div);
        }
    });
}

// --- FUNÇÕES DE MODAL ---

window.abrirVincular = (volId) => {
    const vol = dataCache.volumes.find(v => v.id === volId);
    document.getElementById("modalTitle").innerText = "Endereçar Volume";
    document.getElementById("modalBody").innerHTML = `
        <p>${vol.descricao}</p>
        <div class="field-group">
            <label>Selecione o Endereço:</label>
            <select id="modalSelectEnd">
                ${dataCache.enderecos.map(e => `<option value="${e.id}">RUA ${e.rua} | MOD ${e.modulo} | NIV ${e.nivel}</option>`).join('')}
            </select>
        </div>
    `;
    document.getElementById("modalMaster").style.display = "flex";
    document.getElementById("btnConfirmarModal").onclick = () => salvarVinculo(volId, document.getElementById("modalSelectEnd").value);
};

async function salvarVinculo(volId, endId) {
    await updateDoc(doc(db, "volumes", volId), { enderecoId: endId });
    
    // Histórico
    const vol = dataCache.volumes.find(v => v.id === volId);
    await addDoc(collection(db, "movimentacoes"), {
        produto: `Endereçado: ${vol.descricao}`,
        tipo: "Movimentação", quantidade: vol.quantidade, usuario: auth.currentUser.email, data: serverTimestamp()
    });

    fecharModal();
    renderizarTudo();
}

window.abrirTransferir = (volId, endAtualId) => {
    document.getElementById("modalTitle").innerText = "Transferir de Local";
    document.getElementById("modalBody").innerHTML = `
        <div class="field-group">
            <label>Novo Endereço:</label>
            <select id="modalSelectEnd">
                ${dataCache.enderecos.filter(e => e.id !== endAtualId).map(e => `<option value="${e.id}">RUA ${e.rua} | MOD ${e.modulo}</option>`).join('')}
            </select>
        </div>
    `;
    document.getElementById("modalMaster").style.display = "flex";
    document.getElementById("btnConfirmarModal").onclick = () => salvarVinculo(volId, document.getElementById("modalSelectEnd").value);
};

window.deletarLocal = async (id) => {
    if(confirm("Excluir local? Volumes nele voltarão para 'Não Endereçados'.")){
        await deleteDoc(doc(db, "enderecos", id));
        renderizarTudo();
    }
}

document.getElementById("btnCriarEndereco").onclick = async () => {
    const r = document.getElementById("addRua").value.toUpperCase();
    const m = document.getElementById("addModulo").value;
    const n = document.getElementById("addNivel").value;
    if(!r || !m) return alert("Preencha Rua e Módulo!");

    await addDoc(collection(db, "enderecos"), { rua: r, modulo: m, nivel: n, dataCriacao: serverTimestamp() });
    
    // Histórico
    await addDoc(collection(db, "movimentacoes"), {
        produto: `Novo Endereço: RUA ${r} MOD ${m}`,
        tipo: "Cadastro", quantidade: 0, usuario: auth.currentUser.email, data: serverTimestamp()
    });

    document.getElementById("addRua").value = "";
    document.getElementById("addModulo").value = "";
    renderizarTudo();
};

window.fecharModal = () => document.getElementById("modalMaster").style.display = "none";
window.logout = () => signOut(auth).then(() => window.location.href = "index.html");
