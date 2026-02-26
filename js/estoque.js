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
    // Busca dados para compor as descrições
    const fornecedoresSnap = await getDocs(collection(db, "fornecedores"));
    const fornMap = {};
    fornecedoresSnap.forEach(d => fornMap[d.id] = d.data().nome);

    const produtosSnap = await getDocs(collection(db, "produtos"));
    const prodMap = {};
    produtosSnap.forEach(d => prodMap[d.id] = { nome: d.data().nome, forn: fornMap[d.data().fornecedorId] });

    // Renderiza as duas áreas
    await renderEnderecos(prodMap);
    await renderPendentes(prodMap);
}

async function renderEnderecos(prodMap) {
    const grid = document.getElementById("gridEnderecos");
    grid.innerHTML = "";
    
    // Busca endereços e volumes
    const eSnap = await getDocs(query(collection(db, "enderecos"), orderBy("rua"), orderBy("modulo")));
    const vSnap = await getDocs(collection(db, "volumes"));
    const volumes = vSnap.docs.map(d => ({id: d.id, ...d.data()}));

    eSnap.forEach(de => {
        const end = de.data();
        const endId = de.id;
        const volumesNoLocal = volumes.filter(v => v.enderecoId === endId && v.quantidade > 0);

        const card = document.createElement("div");
        card.className = "card-endereco";
        card.innerHTML = `
            <div class="card-end-header">
                <span>RUA ${end.rua} | M${end.modulo} | N${end.nivel}</span>
                <button onclick="window.deletarEndereco('${endId}')" style="background:none; border:none; color:white; cursor:pointer;">✕</button>
            </div>
            <div class="card-end-body">
                ${volumesNoLocal.map(v => `
                    <div class="vol-item">
                        <span><strong>${v.quantidade}x</strong> ${v.descricao}</span>
                        <button class="btn-action" style="background:var(--gray)" onclick="window.desvincular('${v.id}')">Tirar</button>
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
        // Pendente se: quantidade > 0 E (não tem enderecoId OU enderecoId está vazio)
        if (vol.quantidade > 0 && (!vol.enderecoId || vol.enderecoId === "")) {
            const pInfo = prodMap[vol.produtoId] || { nome: "Produto não encontrado", forn: "---" };
            const div = document.createElement("div");
            div.className = "card-pendente";
            div.innerHTML = `
                <div style="font-weight:bold; color:var(--primary)">${pInfo.forn}</div>
                <div style="margin: 3px 0"><strong>Prod:</strong> ${pInfo.nome}</div>
                <div><strong>Vol:</strong> ${vol.descricao}</div>
                <div style="margin-top:5px; font-weight:bold; color:var(--danger)">Estoque: ${vol.quantidade}</div>
            `;
            lista.appendChild(div);
        }
    });
}

// Ações do Usuário

document.getElementById("btnCriarEndereco").onclick = async () => {
    const rua = document.getElementById("addRua").value.toUpperCase();
    const modulo = document.getElementById("addModulo").value;
    const nivel = document.getElementById("addNivel").value;

    if(!rua || !modulo) return alert("Rua e Módulo são obrigatórios!");

    // No primeiro clique, o Firebase cria a coleção 'enderecos' automaticamente
    await addDoc(collection(db, "enderecos"), { 
        rua, modulo, nivel, 
        dataCriacao: serverTimestamp() 
    });
    
    document.getElementById("addRua").value = "";
    document.getElementById("addModulo").value = "";
    document.getElementById("addNivel").value = "";
    loadAll();
};

window.vincularAqui = async (endId) => {
    const vSnap = await getDocs(collection(db, "volumes"));
    let listaTxt = "Escolha o número do volume para colocar neste endereço:\n\n";
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

    if (disponiveis.length === 0) return alert("Não há volumes com estoque para endereçar!");

    const escolha = prompt(listaTxt);
    if (escolha !== null && disponiveis[escolha]) {
        await updateDoc(doc(db, "volumes", disponiveis[escolha]), { 
            enderecoId: endId 
        });
        loadAll();
    }
};

window.desvincular = async (volId) => {
    if(confirm("Deseja tirar este volume deste endereço? Ele voltará para a lista de pendentes.")){
        await updateDoc(doc(db, "volumes", volId), { enderecoId: "" });
        loadAll();
    }
};

window.deletarEndereco = async (id) => {
    if(confirm("Excluir este local? Os volumes que estavam nele ficarão como 'Não Endereçados'.")){
        await deleteDoc(doc(db, "enderecos", id));
        loadAll();
    }
};

window.logout = () => signOut(auth).then(() => window.location.href = "index.html");
