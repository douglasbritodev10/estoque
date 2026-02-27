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
                    <div style="font-size: 12px; font-weight: bold; margin: 3px 0;">${v.descricao}</div>
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <span>Qtd: <b>${v.quantidade}</b></span>
                        <button onclick="window.abrirMover('${v.id}')" style="background: #28a745; color: white; border: none; padding: 4px 10px; border-radius: 3px; cursor: pointer; font-size: 10px;">GUARDAR</button>
                    </div>
                </div>
            `;
        }
    });

    // Endereços
    const grid = document.getElementById("gridEnderecos");
    grid.innerHTML = "";
    dbState.enderecos.forEach(end => {
        const vols = dbState.volumes.filter(v => v.enderecoId === end.id && v.quantidade > 0);
        grid.innerHTML += `
            <div style="background: white; border: 1px solid #ddd; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
                <div style="background: #004a99; color: white; padding: 8px 12px; font-weight: bold; display: flex; justify-content: space-between;">
                    <span>RUA ${end.rua} - MOD ${end.modulo}</span>
                    <i class="fas fa-trash" onclick="deletarLocal('${end.id}')" style="cursor:pointer; font-size: 12px; opacity: 0.7;"></i>
                </div>
                <div style="padding: 10px; min-height: 50px;">
                    ${vols.map(v => `
                        <div style="background: #f8f9fa; border-bottom: 1px solid #eee; padding: 5px; margin-bottom: 5px;">
                            <div style="font-size: 10px; color: #004a99; font-weight: bold;">${dbState.produtos[v.produtoId]?.forn || ''}</div>
                            <div style="font-size: 12px;"><b>${v.quantidade}x</b> ${v.descricao}</div>
                            <div style="display: flex; gap: 5px; margin-top: 5px;">
                                <button onclick="abrirMover('${v.id}')" style="flex: 1; font-size: 9px; cursor: pointer;">MOVER</button>
                                <button onclick="darSaida('${v.id}')" style="flex: 1; font-size: 9px; color: red; cursor: pointer;">SAÍDA</button>
                            </div>
                        </div>
                    `).join('') || '<div style="color: #ccc; font-size: 11px; text-align: center; margin-top: 10px;">Vazio</div>'}
                </div>
            </div>
        `;
    });
}

// Lógica de Movimentação (WMS)
window.abrirMover = (volId) => {
    const vol = dbState.volumes.find(v => v.id === volId);
    const qtd = prompt(`Mover ${vol.descricao}\nQuantidade disponível: ${vol.quantidade}\nDigite quanto deseja mover:`, vol.quantidade);
    
    if (qtd && parseInt(qtd) > 0) {
        const valor = parseInt(qtd);
        if (valor > vol.quantidade) return alert("Quantidade indisponível!");
        
        const destino = prompt("Para qual RUA e MÓDULO?\nExemplo: A-01");
        if (destino) {
            const [r, m] = destino.split("-");
            const local = dbState.enderecos.find(e => e.rua === r.toUpperCase() && e.modulo === m);
            
            if (local) {
                executarMover(volId, local.id, valor);
            } else {
                alert("Endereço não encontrado! Crie o endereço primeiro.");
            }
        }
    }
};

async function executarMover(volIdOrigem, endIdDestino, qtd) {
    const volOrigem = dbState.volumes.find(v => v.id === volIdOrigem);
    const volNoDestino = dbState.volumes.find(v => v.enderecoId === endIdDestino && v.produtoId === volOrigem.produtoId && v.descricao === volOrigem.descricao);

    if (qtd >= volOrigem.quantidade) {
        if (volNoDestino) {
            await updateDoc(doc(db, "volumes", volNoDestino.id), { quantidade: increment(volOrigem.quantidade) });
            await deleteDoc(doc(db, "volumes", volIdOrigem));
        } else {
            await updateDoc(doc(db, "volumes", volIdOrigem), { enderecoId: endIdDestino });
        }
    } else {
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
    syncUI();
}

window.darSaida = async (volId) => {
    const vol = dbState.volumes.find(v => v.id === volId);
    const q = prompt(`Saída de ${vol.descricao}. Qtd:`, "1");
    if(q && parseInt(q) > 0) {
        await updateDoc(doc(db, "volumes", volId), { quantidade: increment(-parseInt(q)) });
        syncUI();
    }
};

document.getElementById("btnCriarEndereco").onclick = async () => {
    const r = document.getElementById("addRua").value.toUpperCase();
    const m = document.getElementById("addModulo").value;
    const n = document.getElementById("addNivel").value;
    if(r && m) {
        await addDoc(collection(db, "enderecos"), { rua: r, modulo: m, nivel: n, data: serverTimestamp() });
        syncUI();
    }
};

window.logout = () => signOut(auth).then(() => window.location.href = "index.html");
