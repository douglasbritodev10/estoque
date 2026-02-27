import { db, auth } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { 
    collection, addDoc, getDocs, doc, updateDoc, deleteDoc, query, serverTimestamp 
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
        // Carrega Mapas de apoio
        const fSnap = await getDocs(collection(db, "fornecedores"));
        fSnap.forEach(d => dbState.fornecedores[d.id] = d.data().nome);

        const pSnap = await getDocs(collection(db, "produtos"));
        pSnap.forEach(d => {
            const p = d.data();
            dbState.produtos[d.id] = { nome: p.nome, forn: dbState.fornecedores[p.fornecedorId] || "---" };
        });

        await syncUI();
    } catch (e) { console.error("Erro ao carregar dados:", e); }
}

async function syncUI() {
    // Pegamos os dados crus para evitar o erro de INDICE do Firebase
    const eSnap = await getDocs(collection(db, "enderecos"));
    dbState.enderecos = eSnap.docs.map(d => ({id: d.id, ...d.data()}))
        .sort((a,b) => a.rua.localeCompare(b.rua) || a.modulo - b.modulo); // Ordenação via JS

    const vSnap = await getDocs(collection(db, "volumes"));
    dbState.volumes = vSnap.docs.map(d => ({id: d.id, ...d.data()}));

    renderPendentes();
    renderCards();
}

function renderPendentes() {
    const container = document.getElementById("listaPendentes");
    container.innerHTML = "";
    
    dbState.volumes.forEach(v => {
        // Regra: Estoque > 0 e Sem Endereço
        if (v.quantidade > 0 && (!v.enderecoId || v.enderecoId === "")) {
            const p = dbState.produtos[v.produtoId] || {forn: '---'};
            const card = document.createElement("div");
            card.className = "card-pendente";
            card.innerHTML = `
                <div style="font-size:11px; font-weight:bold; color:var(--primary)">${p.forn.split(' ')[0]}</div>
                <div style="font-size:13px; font-weight:600; margin:5px 0;">${v.descricao}</div>
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <span style="font-weight:900;">QTD: ${v.quantidade}</span>
                    <button onclick="window.modalEnderecar('${v.id}')" class="btn-action btn-success" style="padding:6px 10px; font-size:11px;">ENDEREÇAR</button>
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
                <button onclick="window.deletarLocal('${end.id}')" style="background:none; border:none; color:#ff9999; cursor:pointer;"><i class="fas fa-trash"></i></button>
            </div>
            <div class="card-end-body">
                ${volumesAqui.map(v => `
                    <div class="vol-item">
                        <div style="font-size:12px;"><b>${v.quantidade}x</b> ${v.descricao}</div>
                        <button onclick="window.modalTransferir('${v.id}', '${end.id}')" style="margin-top:8px; width:100%; border:1px solid var(--warning); background:none; color:var(--warning); border-radius:4px; font-size:10px; cursor:pointer; font-weight:bold; padding:4px">TRANSFERIR</button>
                    </div>
                `).join('') || '<div style="text-align:center; color:#ccc; font-size:12px; padding:10px">Disponível</div>'}
            </div>
        `;
        grid.appendChild(card);
    });
}

// MODAIS
window.modalEnderecar = (volId) => {
    const vol = dbState.volumes.find(v => v.id === volId);
    document.getElementById("modalTitle").innerText = "Endereçar Volume";
    document.getElementById("modalBody").innerHTML = `
        <p style="background:#f8f9fa; padding:10px; border-radius:8px; font-size:13px;">${vol.descricao}</p>
        <div class="field-group">
            <label>Selecione o Destino:</label>
            <select id="selDestino">
                ${dbState.enderecos.map(e => `<option value="${e.id}">RUA ${e.rua} | MOD ${e.modulo} | NIVEL ${e.nivel}</option>`).join('')}
            </select>
        </div>
    `;
    document.getElementById("modalMaster").style.display = "flex";
    document.getElementById("btnConfirmarModal").onclick = () => concluirMovimentacao(volId, document.getElementById("selDestino").value, "Endereçamento");
};

window.modalTransferir = (volId, localAtualId) => {
    document.getElementById("modalTitle").innerText = "Transferência de Endereço";
    document.getElementById("modalBody").innerHTML = `
        <div class="field-group">
            <label>Mover para qual novo local?</label>
            <select id="selDestino">
                ${dbState.enderecos.filter(e => e.id !== localAtualId).map(e => `<option value="${e.id}">RUA ${e.rua} | MOD ${e.modulo}</option>`).join('')}
            </select>
        </div>
    `;
    document.getElementById("modalMaster").style.display = "flex";
    document.getElementById("btnConfirmarModal").onclick = () => concluirMovimentacao(volId, document.getElementById("selDestino").value, "Transferência");
};

async function concluirMovimentacao(volId, novoEndId, tipoAcao) {
    const vol = dbState.volumes.find(v => v.id === volId);
    await updateDoc(doc(db, "volumes", volId), { enderecoId: novoEndId });

    // Registra no Histórico
    await addDoc(collection(db, "movimentacoes"), {
        produto: `${tipoAcao}: ${vol.descricao}`,
        tipo: "Logística",
        quantidade: vol.quantidade,
        usuario: auth.currentUser.email,
        data: serverTimestamp()
    });

    fecharModal();
    syncUI();
}

document.getElementById("btnCriarEndereco").onclick = async () => {
    const r = document.getElementById("addRua").value.toUpperCase();
    const m = document.getElementById("addModulo").value;
    const n = document.getElementById("addNivel").value;
    if(!r || !m) return alert("Rua e Módulo são obrigatórios!");

    await addDoc(collection(db, "enderecos"), { rua: r, modulo: m, nivel: n, dataCriacao: serverTimestamp() });
    
    // Histórico da Estrutura
    await addDoc(collection(db, "movimentacoes"), {
        produto: `Novo Local: RUA ${r} MOD ${m}`,
        tipo: "Estrutura", quantidade: 0, usuario: auth.currentUser.email, data: serverTimestamp()
    });

    document.getElementById("addRua").value = "";
    document.getElementById("addModulo").value = "";
    syncUI();
};

window.deletarLocal = async (id) => {
    if(confirm("Excluir este endereço? Itens nele voltarão para a lista de pendentes.")){
        await deleteDoc(doc(db, "enderecos", id));
        syncUI();
    }
};

window.fecharModal = () => document.getElementById("modalMaster").style.display = "none";
window.logout = () => signOut(auth).then(() => window.location.href = "index.html");
