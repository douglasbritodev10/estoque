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
    const vSnap = await getDocs(collection(db, "volumes"));
    
    dbState.enderecos = eSnap.docs.map(d => ({id: d.id, ...d.data()}))
        .sort((a,b) => a.rua.localeCompare(b.rua) || a.modulo - b.modulo);
    dbState.volumes = vSnap.docs.map(d => ({id: d.id, ...d.data()}));

    render();
}

function render() {
    // Pendentes
    const lista = document.getElementById("listaPendentes");
    lista.innerHTML = "";
    dbState.volumes.forEach(v => {
        if (v.quantidade > 0 && (!v.enderecoId || v.enderecoId === "")) {
            const p = dbState.produtos[v.produtoId] || {forn: '---'};
            lista.innerHTML += `
                <div class="card-pendente" style="border-left: 5px solid #dc3545; padding: 10px; background: #fff; margin-bottom: 8px; border-radius: 4px; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
                    <div style="font-size: 9px; color: #004a99; font-weight: bold;">${p.forn}</div>
                    <div style="font-size: 12px; font-weight: bold;">${v.descricao}</div>
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <span>Qtd: <b>${v.quantidade}</b></span>
                        <button onclick="window.abrirModalMover('${v.id}')" style="background: #28a745; color: white; border: none; padding: 4px 10px; border-radius: 3px; cursor: pointer; font-size: 10px;">GUARDAR</button>
                    </div>
                </div>
            `;
        }
    });

    // Grid Endereços
    const grid = document.getElementById("gridEnderecos");
    grid.innerHTML = "";
    dbState.enderecos.forEach(end => {
        const vols = dbState.volumes.filter(v => v.enderecoId === end.id && v.quantidade > 0);
        grid.innerHTML += `
            <div style="background: white; border: 1px solid #ddd; border-radius: 8px; overflow: hidden;">
                <div style="background: #004a99; color: white; padding: 8px 12px; font-weight: bold; display: flex; justify-content: space-between;">
                    <span>RUA ${end.rua} - MOD ${end.modulo}</span>
                    <i class="fas fa-trash" onclick="deletarLocal('${end.id}')" style="cursor:pointer; font-size: 12px;"></i>
                </div>
                <div style="padding: 10px;">
                    ${vols.map(v => `
                        <div style="background: #f8f9fa; border-bottom: 1px solid #eee; padding: 5px; margin-bottom: 5px;">
                            <div style="font-size: 12px;"><b>${v.quantidade}x</b> ${v.descricao}</div>
                            <button onclick="abrirModalMover('${v.id}')" style="font-size: 9px; margin-top: 5px; cursor: pointer;">Mover</button>
                        </div>
                    `).join('') || '<div style="color: #ccc; font-size: 11px; text-align: center;">Vazio</div>'}
                </div>
            </div>
        `;
    });
}

// MODAL COM LISTA SUSPENSA (SELECT)
window.abrirModalMover = (volId) => {
    const vol = dbState.volumes.find(v => v.id === volId);
    const modal = document.getElementById("modalMaster");
    document.getElementById("modalTitle").innerText = `Mover: ${vol.descricao}`;
    
    document.getElementById("modalBody").innerHTML = `
        <div style="display:flex; flex-direction:column; gap:10px;">
            <label style="font-size:12px; font-weight:bold;">Selecione o Endereço de Destino:</label>
            <select id="selectDestino" style="padding:10px; border-radius:4px; border:1px solid #ccc;">
                ${dbState.enderecos.map(e => `<option value="${e.id}">RUA ${e.rua} - MOD ${e.modulo}</option>`).join('')}
            </select>
            <label style="font-size:12px; font-weight:bold;">Quantidade (Disponível: ${vol.quantidade}):</label>
            <input type="number" id="inputQtdMover" value="${vol.quantidade}" max="${vol.quantidade}" min="1" style="padding:10px; border-radius:4px; border:1px solid #ccc;">
        </div>
    `;
    
    modal.style.display = "flex";
    document.getElementById("btnConfirmar").onclick = () => {
        const endId = document.getElementById("selectDestino").value;
        const qtd = parseInt(document.getElementById("inputQtdMover").value);
        if(qtd > 0) processarMover(volId, endId, qtd);
    };
};

async function processarMover(volId, endId, qtd) {
    const volOrigem = dbState.volumes.find(v => v.id === volId);
    const volDestino = dbState.volumes.find(v => v.enderecoId === endId && v.produtoId === volOrigem.produtoId && v.descricao === volOrigem.descricao);

    if (qtd >= volOrigem.quantidade) {
        if (volDestino) {
            await updateDoc(doc(db, "volumes", volDestino.id), { quantidade: increment(volOrigem.quantidade) });
            await deleteDoc(doc(db, "volumes", volId));
        } else {
            await updateDoc(doc(db, "volumes", volId), { enderecoId: endId });
        }
    } else {
        await updateDoc(doc(db, "volumes", volId), { quantidade: increment(-qtd) });
        if (volDestino) {
            await updateDoc(doc(db, "volumes", volDestino.id), { quantidade: increment(qtd) });
        } else {
            await addDoc(collection(db, "volumes"), {
                produtoId: volOrigem.produtoId,
                descricao: volOrigem.descricao,
                quantidade: qtd,
                enderecoId: endId
            });
        }
    }
    document.getElementById("modalMaster").style.display = "none";
    syncUI();
}

// Funções de Estrutura
document.getElementById("btnCriarEndereco").onclick = async () => {
    const r = document.getElementById("addRua").value.toUpperCase();
    const m = document.getElementById("addModulo").value;
    const n = document.getElementById("addNivel").value;
    if(r && m) {
        await addDoc(collection(db, "enderecos"), { rua: r, modulo: m, nivel: n, data: serverTimestamp() });
        syncUI();
    }
};

window.deletarLocal = async (id) => {
    if(confirm("Excluir endereço?")) {
        await deleteDoc(doc(db, "enderecos", id));
        syncUI();
    }
};

window.fecharModal = () => document.getElementById("modalMaster").style.display = "none";
window.logout = () => signOut(auth).then(() => window.location.href = "index.html");
