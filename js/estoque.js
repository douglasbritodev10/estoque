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
    syncUI();
}

async function syncUI() {
    const eSnap = await getDocs(collection(db, "enderecos"));
    dbState.enderecos = eSnap.docs.map(d => ({id: d.id, ...d.data()}))
        .sort((a,b) => a.rua.localeCompare(b.rua) || a.modulo - b.modulo);

    const vSnap = await getDocs(collection(db, "volumes"));
    dbState.volumes = vSnap.docs.map(d => ({id: d.id, ...d.data()}));

    render();
}

function render() {
    // 1. Renderizar Pendentes (Volumes sem endereço)
    const container = document.getElementById("listaPendentes");
    container.innerHTML = "";
    dbState.volumes.forEach(v => {
        if (v.quantidade > 0 && (!v.enderecoId || v.enderecoId === "")) {
            const prod = dbState.produtos[v.produtoId] || {forn: '---'};
            const div = document.createElement("div");
            div.className = "card-pendente";
            div.innerHTML = `
                <div style="font-size:9px; font-weight:bold; color:var(--primary);">${prod.forn}</div>
                <div style="font-size:12px; font-weight:bold; margin:4px 0;">${v.descricao}</div>
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <span>Qtd: <b>${v.quantidade}</b></span>
                    <button onclick="window.abrirMover('${v.id}')" style="background:var(--success); color:white; border:none; padding:4px 8px; border-radius:3px; cursor:pointer; font-size:10px;">GUARDAR</button>
                </div>
            `;
            container.appendChild(div);
        }
    });

    // 2. Renderizar Grid de Endereços
    const grid = document.getElementById("gridEnderecos");
    grid.innerHTML = "";
    dbState.enderecos.forEach(end => {
        const volsAqui = dbState.volumes.filter(v => v.enderecoId === end.id && v.quantidade > 0);
        const div = document.createElement("div");
        div.className = "card-endereco";
        div.innerHTML = `
            <div class="card-end-header">
                <span>RUA ${end.rua} - MOD ${end.modulo}</span>
                <i class="fas fa-trash" onclick="window.deletarLocal('${end.id}')" style="cursor:pointer; opacity:0.7;"></i>
            </div>
            <div class="card-end-body">
                ${volsAqui.map(v => {
                    const prod = dbState.produtos[v.produtoId] || {forn: '---'};
                    return `
                    <div class="vol-item">
                        <div class="vol-item-forn">${prod.forn}</div>
                        <div class="vol-item-desc">${v.quantidade}x ${v.descricao}</div>
                        <div style="margin-top:8px; display:flex; gap:5px;">
                            <button onclick="window.abrirMover('${v.id}')" style="flex:1; font-size:9px; cursor:pointer;">MOVER</button>
                            <button onclick="window.darSaida('${v.id}')" style="flex:1; font-size:9px; color:var(--danger); cursor:pointer;">SAÍDA</button>
                        </div>
                    </div>`;
                }).join('') || '<div style="color:#ccc; font-size:11px; text-align:center;">Vazio</div>'}
            </div>
        `;
        grid.appendChild(div);
    });
}

// --- FUNÇÕES DE MOVIMENTAÇÃO (WMS) ---

window.abrirMover = (volId) => {
    const vol = dbState.volumes.find(v => v.id === volId);
    document.getElementById("modalTitle").innerText = "Movimentar Produto";
    document.getElementById("modalBody").innerHTML = `
        <p style="font-size:13px;"><b>Item:</b> ${vol.descricao}</p>
        <div class="field-group">
            <label>QUANTIDADE A MOVER (MAX: ${vol.quantidade})</label>
            <input type="number" id="qtdMover" value="${vol.quantidade}" max="${vol.quantidade}" min="1">
        </div>
        <div class="field-group" style="margin-top:10px;">
            <label>DESTINO</label>
            <select id="destinoMover" style="padding:8px; border-radius:4px;">
                ${dbState.enderecos.map(e => `<option value="${e.id}">RUA ${e.rua} - MOD ${e.modulo}</option>`).join('')}
            </select>
        </div>
    `;
    document.getElementById("modalMaster").style.display = "flex";
    document.getElementById("btnConfirmar").onclick = () => processarMover(volId, document.getElementById("destinoMover").value, parseInt(document.getElementById("qtdMover").value));
};

async function processarMover(volIdOrigem, endIdDestino, qtd) {
    const volOrigem = dbState.volumes.find(v => v.id === volIdOrigem);
    
    // Agrupamento: Verifica se já existe o mesmo produto no endereço de destino
    const volDestino = dbState.volumes.find(v => v.enderecoId === endIdDestino && v.produtoId === volOrigem.produtoId && v.descricao === volOrigem.descricao);

    if (qtd >= volOrigem.quantidade) {
        // Move o lote inteiro
        if (volDestino) {
            await updateDoc(doc(db, "volumes", volDestino.id), { quantidade: increment(volOrigem.quantidade) });
            await deleteDoc(doc(db, "volumes", volIdOrigem));
        } else {
            await updateDoc(doc(db, "volumes", volIdOrigem), { enderecoId: endIdDestino });
        }
    } else {
        // Move parte do lote (Cria/Soma no destino e subtrai da origem)
        await updateDoc(doc(db, "volumes", volIdOrigem), { quantidade: increment(-qtd) });
        if (volDestino) {
            await updateDoc(doc(db, "volumes", volDestino.id), { quantidade: increment(qtd) });
        } else {
            await addDoc(collection(db, "volumes"), {
                produtoId: volOrigem.produtoId,
                descricao: volOrigem.descricao,
                quantidade: qtd,
                enderecoId: endIdDestino
            });
        }
    }
    fecharModal();
    loadAll();
}

window.darSaida = async (volId) => {
    const vol = dbState.volumes.find(v => v.id === volId);
    const qtd = prompt(`Baixa de estoque em: ${vol.descricao}\nQuantas unidades saíram?`, "1");
    if(qtd && parseInt(qtd) > 0) {
        await updateDoc(doc(db, "volumes", volId), { quantidade: increment(-parseInt(qtd)) });
        loadAll();
    }
};

window.criarLocal = async () => {
    const r = document.getElementById("addRua").value.toUpperCase();
    const m = document.getElementById("addModulo").value;
    const n = document.getElementById("addNivel").value;
    if(!r || !m) return alert("Rua e Módulo são obrigatórios!");
    await addDoc(collection(db, "enderecos"), { rua: r, modulo: m, nivel: n, data: serverTimestamp() });
    loadAll();
};

window.deletarLocal = async (id) => {
    if(confirm("Deseja apagar este local? Produtos aqui voltarão para 'Não Endereçados'.")){
        const afetados = dbState.volumes.filter(v => v.enderecoId === id);
        for(let v of afetados) { await updateDoc(doc(db, "volumes", v.id), { enderecoId: "" }); }
        await deleteDoc(doc(db, "enderecos", id));
        loadAll();
    }
};

window.fecharModal = () => document.getElementById("modalMaster").style.display = "none";
window.logout = () => signOut(auth).then(() => window.location.href = "index.html");
