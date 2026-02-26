import { db, auth } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { 
    collection, addDoc, getDocs, doc, updateDoc, deleteDoc, query, orderBy, where, serverTimestamp 
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

onAuthStateChanged(auth, user => {
    if (user) {
        document.getElementById("labelUser").innerText = `Olá, ${user.email.split('@')[0].toUpperCase()}`;
        loadAll();
    } else { window.location.href = "index.html"; }
});

async function loadAll() {
    const fornecedoresSnap = await getDocs(collection(db, "fornecedores"));
    const fornMap = {};
    fornecedoresSnap.forEach(d => fornMap[d.id] = d.data().nome);

    const produtosSnap = await getDocs(collection(db, "produtos"));
    const prodMap = {};
    produtosSnap.forEach(d => prodMap[d.id] = { nome: d.data().nome, forn: fornMap[d.data().fornecedorId] });

    await renderEnderecos(prodMap);
    await renderPendentes(prodMap);
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
        const volumesNoLocal = volumes.filter(v => v.enderecoId === endId);

        const card = document.createElement("div");
        card.className = "card-endereco";
        card.innerHTML = `
            <div class="card-end-header">
                <span>RUA ${end.rua} - M${end.modulo} - N${end.nivel}</span>
                <button onclick="window.deletarEndereco('${endId}')" style="background:none; border:none; color:white; cursor:pointer;">✕</button>
            </div>
            <div class="card-end-body" id="body-${endId}">
                ${volumesNoLocal.map(v => `
                    <div class="vol-item">
                        <span><strong>${v.quantidade}x</strong> ${v.descricao}</span>
                        <button class="btn-action" style="background:var(--gray)" onclick="window.desvincular('${v.id}')">Sair</button>
                    </div>
                `).join('')}
                <button class="btn-action" style="background:var(--success); width:100%; margin-top:10px" onclick="window.vincularAqui('${endId}')">+ Vincular Volume</button>
            </div>
        `;
        grid.appendChild(card);
    });
}

async function renderPendentes(prodMap) {
    const lista = document.getElementById("listaPendentes");
    lista.innerHTML = "";
    
    const vSnap = await getDocs(collection(db, "volumes"));
    
    vSnap.forEach(dv => {
        const vol = dv.data();
        // Se não tem enderecoId ou está vazio, é pendente
        if (!vol.enderecoId) {
            const pInfo = prodMap[vol.produtoId] || { nome: "Produto Excluído", forn: "---" };
            const div = document.createElement("div");
            div.className = "card-pendente";
            div.innerHTML = `
                <div style="font-weight:bold; color:var(--primary)">${pInfo.forn}</div>
                <div>${pInfo.nome}</div>
                <div style="color:var(--secondary)">Vol: ${vol.descricao}</div>
                <div style="margin-top:5px; font-weight:bold">Qtd: ${vol.quantidade}</div>
            `;
            lista.appendChild(div);
        }
    });
}

// AÇÕES

document.getElementById("btnCriarEndereco").onclick = async () => {
    const rua = document.getElementById("addRua").value.toUpperCase();
    const modulo = document.getElementById("addModulo").value;
    const nivel = document.getElementById("addNivel").value;

    if(!rua || !modulo) return alert("Preencha Rua e Módulo!");

    await addDoc(collection(db, "enderecos"), { rua, modulo, nivel, dataCriacao: serverTimestamp() });
    location.reload();
};

window.vincularAqui = async (endId) => {
    const vSnap = await getDocs(collection(db, "volumes"));
    let listaTxt = "Digite o número do volume para endereçar:\n\n";
    const disponiveis = [];

    let i = 0;
    vSnap.forEach(dv => {
        if (!dv.data().enderecoId) {
            disponiveis.push(dv.id);
            listaTxt += `${i} - ${dv.data().descricao} (${dv.data().quantidade} un)\n`;
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

window.desvincular = async (volId) => {
    if(confirm("Remover este volume deste endereço? Ele voltará para a lista de pendentes.")){
        await updateDoc(doc(db, "volumes", volId), { enderecoId: "" });
        loadAll();
    }
};

window.deletarEndereco = async (id) => {
    if(confirm("Excluir este endereço? Volumes nele ficarão sem endereço.")){
        await deleteDoc(doc(db, "enderecos", id));
        loadAll();
    }
};
