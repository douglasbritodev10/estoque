import { db, auth } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { 
    collection, addDoc, getDocs, doc, updateDoc, deleteDoc, serverTimestamp, increment 
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

let dbState = { fornecedores: {}, produtos: {}, enderecos: [], volumes: [] };

onAuthStateChanged(auth, user => {
    if (user) {
        document.getElementById("labelUser").innerText = `Olá, ${user.email.split('@')[0].toUpperCase()}`;
        loadAll();
    } else { window.location.href = "index.html"; }
});

async function loadAll() {
    const fSnap = await getDocs(collection(db, "fornecedores"));
    fSnap.forEach(d => dbState.fornecedores[d.id] = d.data().nome);

    const pSnap = await getDocs(collection(db, "produtos"));
    pSnap.forEach(d => {
        const p = d.data();
        dbState.produtos[d.id] = { nome: p.nome, forn: dbState.fornecedores[p.fornecedorId] || "---" };
    });
    await syncUI();
}

async function syncUI() {
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
        if (v.quantidade > 0 && (!v.enderecoId || v.enderecoId === "")) {
            const p = dbState.produtos[v.produtoId] || {forn: '---'};
            const card = document.createElement("div");
            card.className = "card-pendente";
            card.innerHTML = `
                <div style="font-size:10px; font-weight:bold; color:var(--primary)">${p.forn.toUpperCase()}</div>
                <div style="font-size:13px; font-weight:600; margin:5px 0;">${v.descricao}</div>
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <span style="font-weight:900;">QTD: ${v.quantidade}</span>
                    <button onclick="window.abrirModalMover('${v.id}')" class="btn-action" style="background:var(--success); padding:5px 10px;">ENDEREÇAR</button>
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
                <span>RUA ${end.rua} - M${end.modulo}</span>
                <button onclick="window.deletarLocal('${end.id}')" style="background:none; border:none; color:#ff9999; cursor:pointer;"><i class="fas fa-trash"></i></button>
            </div>
            <div class="card-end-body">
                ${volumesAqui.map(v => {
                    const p = dbState.produtos[v.produtoId] || {forn: '---'};
                    return `
                    <div class="vol-item">
                        <div style="font-size:9px; font-weight:bold; color:var(--primary);">${p.forn}</div>
                        <div style="font-size:12px;"><b>${v.quantidade}x</b> ${v.descricao}</div>
                        <div style="display:flex; gap:5px; margin-top:8px;">
                            <button onclick="window.abrirModalMover('${v.id}')" style="flex:1; border:1px solid var(--warning); color:var(--warning); background:none; font-size:10px; cursor:pointer;">MOVER</button>
                            <button onclick="window.darSaida('${v.id}')" style="flex:1; border:1px solid var(--danger); color:var(--danger); background:none; font-size:10px; cursor:pointer;">SAÍDA</button>
                        </div>
                    </div>`;
                }).join('') || '<div style="text-align:center; color:#ccc; font-size:11px;">Vazio</div>'}
            </div>
        `;
        grid.appendChild(card);
    });
}

window.abrirModalMover = (volId) => {
    const vol = dbState.volumes.find(v => v.id === volId);
    document.getElementById("modalTitle").innerText = "Movimentar Lote";
    document.getElementById("modalBody").innerHTML = `
        <div style="margin-bottom:15px; font-size:13px;"><b>Item:</b> ${vol.descricao}</div>
        <div style="display:flex; flex-direction:column; gap:10px;">
            <label style="font-size:11px; font-weight:bold;">QUANTIDADE (DISPONÍVEL: ${vol.quantidade})</label>
            <input type="number" id="movQtd" value="${vol.quantidade}" min="1" max="${vol.quantidade}" style="padding:10px; border-radius:8px; border:1px solid #ccc;">
            <label style="font-size:11px; font-weight:bold;">DESTINO</label>
            <select id="movDestino" style="padding:10px; border-radius:8px; border:1px solid #ccc;">
                ${dbState.enderecos.map(e => `<option value="${e.id}">RUA ${e.rua} - MOD ${e.modulo}</option>`).join('')}
            </select>
        </div>
    `;
    document.getElementById("modalMaster").style.display = "flex";
    document.getElementById("btnConfirmarModal").onclick = () => executarMover(volId, document.getElementById("movDestino").value, parseInt(document.getElementById("movQtd").value));
};

async function executarMover(volOrigemId, endDestinoId, qtdMover) {
    const volOrigem = dbState.volumes.find(v => v.id === volOrigemId);
    
    // REGRA DE AGRUPAMENTO: Se já existe exatamente o mesmo volume (mesmo produtoId e descrição) no destino, somamos.
    const volDestinoExistente = dbState.volumes.find(v => 
        v.enderecoId === endDestinoId && 
        v.produtoId === volOrigem.produtoId && 
        v.descricao === volOrigem.descricao
    );

    if (qtdMover >= volOrigem.quantidade) {
        // MOVE TUDO
        if (volDestinoExistente) {
            await updateDoc(doc(db, "volumes", volDestinoExistente.id), { quantidade: increment(volOrigem.quantidade) });
            await deleteDoc(doc(db, "volumes", volOrigemId));
        } else {
            await updateDoc(doc(db, "volumes", volOrigemId), { enderecoId: endDestinoId });
        }
    } else {
        // MOVE PARCIAL: Mantém a origem e cria/soma no destino
        await updateDoc(doc(db, "volumes", volOrigemId), { quantidade: increment(-qtdMover) });
        if (volDestinoExistente) {
            await updateDoc(doc(db, "volumes", volDestinoExistente.id), { quantidade: increment(qtdMover) });
        } else {
            await addDoc(collection(db, "volumes"), {
                produtoId: volOrigem.produtoId,
                descricao: volOrigem.descricao,
                quantidade: qtdMover,
                enderecoId: endDestinoId
            });
        }
    }
    fecharModal();
    syncUI();
}

window.darSaida = async (volId) => {
    const vol = dbState.volumes.find(v => v.id === volId);
    const qtd = prompt(`Quantas unidades saíram de ${vol.descricao}?`, "1");
    if (qtd && parseInt(qtd) > 0) {
        const valor = parseInt(qtd);
        if(valor > vol.quantidade) return alert("Quantidade maior do que a disponível no endereço!");
        await updateDoc(doc(db, "volumes", volId), { quantidade: increment(-valor) });
        syncUI();
    }
};

window.deletarLocal = async (id) => {
    if(confirm("Excluir local? Os produtos aqui voltarão para 'Não Endereçados'.")){
        const afetados = dbState.volumes.filter(v => v.enderecoId === id);
        for (const v of afetados) { await updateDoc(doc(db, "volumes", v.id), { enderecoId: "" }); }
        await deleteDoc(doc(db, "enderecos", id));
        syncUI();
    }
};

document.getElementById("btnCriarEndereco").onclick = async () => {
    const r = document.getElementById("addRua").value.toUpperCase();
    const m = document.getElementById("addModulo").value;
    const n = document.getElementById("addNivel").value;
    if(!r || !m) return alert("Preencha Rua e Módulo!");
    await addDoc(collection(db, "enderecos"), { rua: r, modulo: m, nivel: n, dataCriacao: serverTimestamp() });
    syncUI();
};

window.fecharModal = () => document.getElementById("modalMaster").style.display = "none";
window.logout = () => signOut(auth).then(() => window.location.href = "index.html");
