import { db, auth } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { 
    collection, addDoc, getDocs, doc, updateDoc, deleteDoc, query, orderBy, serverTimestamp 
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

onAuthStateChanged(auth, user => {
    if (user) {
        document.getElementById("labelUser").innerText = `Olá, ${user.email.split('@')[0]}`;
        loadAll();
    } else { window.location.href = "index.html"; }
});

async function loadAll() {
    // 1. Mapeia Fornecedores
    const fSnap = await getDocs(collection(db, "fornecedores"));
    const fornMap = {};
    fSnap.forEach(d => fornMap[d.id] = d.data().nome);

    // 2. Mapeia Produtos vinculando o nome do Fornecedor
    const pSnap = await getDocs(collection(db, "produtos"));
    const prodMap = {};
    pSnap.forEach(d => {
        const data = d.data();
        prodMap[d.id] = { nome: data.nome, forn: fornMap[data.fornecedorId] || "---" };
    });

    renderEnderecos(prodMap);
    renderPendentes(prodMap);
}

async function renderEnderecos(prodMap) {
    const grid = document.getElementById("gridEnderecos");
    grid.innerHTML = "";
    
    const eSnap = await getDocs(query(collection(db, "enderecos"), orderBy("rua"), orderBy("modulo")));
    const vSnap = await getDocs(collection(db, "volumes"));
    const volumes = vSnap.docs.map(d => ({id: d.id, ...d.data()}));

    eSnap.forEach(de => {
        const end = de.data();
        const endId = de.id;
        // Filtra apenas volumes vinculados a este endereço com QTD > 0
        const noLocal = volumes.filter(v => v.enderecoId === endId && v.quantidade > 0);

        const card = document.createElement("div");
        card.className = "card-endereco";
        card.innerHTML = `
            <div class="card-end-header">
                <span>RUA ${end.rua} | M${end.modulo} | N${end.nivel}</span>
                <button onclick="window.deletarEndereco('${endId}')" style="background:none; border:none; color:white; cursor:pointer;">✕</button>
            </div>
            <div class="card-end-body">
                ${noLocal.map(v => {
                    const p = prodMap[v.produtoId] || { nome: "N/A", forn: "---" };
                    return `
                    <div class="vol-item">
                        <span>[${p.forn}] <strong>${v.quantidade}x</strong> ${v.descricao}</span>
                        <button class="btn-action" style="background:var(--gray)" onclick="window.desvincular('${v.id}')">Tirar</button>
                    </div>`;
                }).join('')}
                <button class="btn-action" style="background:var(--success); width:100%; margin-top:10px" onclick="window.vincularAqui('${endId}')">+ Vincular</button>
            </div>`;
        grid.appendChild(card);
    });
}

async function renderPendentes(prodMap) {
    const lista = document.getElementById("listaPendentes");
    lista.innerHTML = "";
    const vSnap = await getDocs(collection(db, "volumes"));
    
    vSnap.forEach(dv => {
        const vol = dv.data();
        // Aparece aqui se tiver estoque mas não tiver endereço
        if (vol.quantidade > 0 && (!vol.enderecoId || vol.enderecoId === "")) {
            const p = prodMap[vol.produtoId] || { nome: "Produto não encontrado", forn: "---" };
            const div = document.createElement("div");
            div.className = "card-pendente";
            div.innerHTML = `
                <div style="font-weight:bold; color:var(--primary)">${p.forn}</div>
                <div><strong>Prod:</strong> ${p.nome}</div>
                <div><strong>Vol:</strong> ${vol.descricao}</div>
                <div style="margin-top:5px; font-weight:bold; color:var(--danger)">QTD: ${vol.quantidade}</div>
            `;
            lista.appendChild(div);
        }
    });
}

// Vinculação por prompt para facilitar a escolha
window.vincularAqui = async (endId) => {
    const vSnap = await getDocs(collection(db, "volumes"));
    let listaTxt = "Selecione o número do volume:\n\n";
    const disponiveis = [];

    let i = 0;
    vSnap.forEach(dv => {
        const data = dv.data();
        if (data.quantidade > 0 && (!data.enderecoId || data.enderecoId === "")) {
            disponiveis.push(dv.id);
            listaTxt += `${i} - ${data.descricao} (${data.quantidade} un)\n`;
            i++;
        }
    });

    if (disponiveis.length === 0) return alert("Não há volumes pendentes!");
    const escolha = prompt(listaTxt);
    if (escolha !== null && disponiveis[escolha]) {
        await updateDoc(doc(db, "volumes", disponiveis[escolha]), { enderecoId: endId });
        loadAll();
    }
};

window.deletarEndereco = async (id) => {
    if(confirm("Excluir local? Itens nele voltarão para 'Não Endereçados'.")) {
        await deleteDoc(doc(db, "enderecos", id));
        loadAll();
    }
};

window.desvincular = async (volId) => {
    await updateDoc(doc(db, "volumes", volId), { enderecoId: "" });
    loadAll();
};

document.getElementById("btnCriarEndereco").onclick = async () => {
    const rua = document.getElementById("addRua").value.toUpperCase();
    const mod = document.getElementById("addModulo").value;
    const niv = document.getElementById("addNivel").value;
    if(!rua || !mod) return alert("Preencha os campos!");
    await addDoc(collection(db, "enderecos"), { rua, modulo: mod, nivel: niv, dataCriacao: serverTimestamp() });
    loadAll();
};

window.logout = () => signOut(auth).then(() => window.location.href = "index.html");
