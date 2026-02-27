import { db, auth } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { 
    collection, addDoc, getDocs, doc, updateDoc, deleteDoc, query, orderBy, serverTimestamp 
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

onAuthStateChanged(auth, user => {
    if (user) {
        document.getElementById("labelUser").innerText = `Olá, ${user.email.split('@')[0].toUpperCase()}`;
        loadAll();
    } else { window.location.href = "index.html"; }
});

async function loadAll() {
    // 1. Busca Fornecedores
    const fSnap = await getDocs(collection(db, "fornecedores"));
    const fornMap = {};
    fSnap.forEach(d => {
        // Pega apenas o primeiro nome para não ficar muito longo no card
        const nomeCompleto = d.data().nome || "---";
        fornMap[d.id] = nomeCompleto.split(' ')[0]; 
    });

    // 2. Busca Produtos
    const pSnap = await getDocs(collection(db, "produtos"));
    const prodMap = {};
    pSnap.forEach(d => {
        const p = d.data();
        prodMap[d.id] = { nome: p.nome, forn: fornMap[p.fornecedorId] || "---" };
    });

    // 3. Renderiza as listas
    renderEnderecos(prodMap);
    renderPendentes(prodMap);
}

async function renderEnderecos(prodMap) {
    const grid = document.getElementById("gridEnderecos");
    if (!grid) return;
    grid.innerHTML = "";
    
    // Busca os endereços criados no banco
    const eSnap = await getDocs(query(collection(db, "enderecos"), orderBy("rua"), orderBy("modulo")));
    const vSnap = await getDocs(collection(db, "volumes"));
    const volumes = vSnap.docs.map(d => ({id: d.id, ...d.data()}));

    eSnap.forEach(de => {
        const end = de.data();
        const endId = de.id;
        // Filtra volumes que pertencem a este endereço e têm estoque
        const volumesNoLocal = volumes.filter(v => v.enderecoId === endId && v.quantidade > 0);

        const card = document.createElement("div");
        card.className = "card-endereco";
        card.innerHTML = `
            <div class="card-end-header">
                <span>RUA ${end.rua} | M${end.modulo} | N${end.nivel}</span>
                <button onclick="window.deletarEndereco('${endId}')" style="background:none; border:none; color:white; cursor:pointer; font-weight:bold;">✕</button>
            </div>
            <div class="card-end-body">
                ${volumesNoLocal.length > 0 ? volumesNoLocal.map(v => {
                    const p = prodMap[v.produtoId] || { nome: "N/A", forn: "---" };
                    return `
                    <div class="vol-item">
                        <span><strong>${v.quantidade}x</strong> [${p.forn}] ${v.descricao}</span>
                        <button class="btn-action" style="background:var(--gray)" onclick="window.desvincular('${v.id}')">Tirar</button>
                    </div>`;
                }).join('') : '<p style="color:#999; text-align:center">Vazio</p>'}
                
                <button class="btn-action" style="background:var(--success); width:100%; margin-top:10px; height:30px" onclick="window.vincularAqui('${endId}')">
                    + VINCULAR VOLUME
                </button>
            </div>
        `;
        grid.appendChild(card);
    });
}

async function renderPendentes(prodMap) {
    const lista = document.getElementById("listaPendentes");
    if (!lista) return;
    lista.innerHTML = "";
    
    const vSnap = await getDocs(collection(db, "volumes"));
    
    vSnap.forEach(dv => {
        const vol = dv.data();
        // Aparece na esquerda se quantidade > 0 e sem endereço
        if (vol.quantidade > 0 && (!vol.enderecoId || vol.enderecoId === "")) {
            const p = prodMap[vol.produtoId] || { nome: "Desconhecido", forn: "---" };
            const div = document.createElement("div");
            div.className = "card-pendente";
            div.innerHTML = `
                <div style="font-weight:bold; color:var(--primary)">${p.forn}</div>
                <div style="font-size:11px"><strong>Prod:</strong> ${p.nome}</div>
                <div style="font-size:11px"><strong>Vol:</strong> ${vol.descricao}</div>
                <div style="margin-top:5px; font-weight:bold; color:var(--danger)">QTD: ${vol.quantidade}</div>
            `;
            lista.appendChild(div);
        }
    });
}

// --- FUNÇÕES DE AÇÃO ---

document.getElementById("btnCriarEndereco").onclick = async () => {
    const rua = document.getElementById("addRua").value.toUpperCase();
    const modulo = document.getElementById("addModulo").value;
    const nivel = document.getElementById("addNivel").value;

    if(!rua || !modulo) return alert("Preencha Rua e Módulo!");

    await addDoc(collection(db, "enderecos"), { 
        rua, modulo, nivel, 
        dataCriacao: serverTimestamp() 
    });
    
    document.getElementById("addRua").value = "";
    document.getElementById("addModulo").value = "";
    document.getElementById("addNivel").value = "";
    loadAll(); // Recarrega os cards na tela
};

window.vincularAqui = async (endId) => {
    const vSnap = await getDocs(collection(db, "volumes"));
    let listaTxt = "Digite o número do volume para este endereço:\n\n";
    const disponiveis = [];

    let i = 0;
    vSnap.forEach(dv => {
        const data = dv.data();
        if (data.quantidade > 0 && (!data.enderecoId || data.enderecoId === "")) {
            disponiveis.push({id: dv.id, desc: data.descricao});
            listaTxt += `${i} - ${data.descricao} (${data.quantidade} un)\n`;
            i++;
        }
    });

    if (disponiveis.length === 0) return alert("Não há volumes pendentes para endereçar!");

    const escolha = prompt(listaTxt);
    if (escolha !== null && disponiveis[escolha]) {
        await updateDoc(doc(db, "volumes", disponiveis[escolha].id), { 
            enderecoId: endId 
        });
        loadAll(); // Atualiza a tela: sai da esquerda e entra no card
    }
};

window.desvincular = async (volId) => {
    if(confirm("Remover volume deste endereço?")){
        await updateDoc(doc(db, "volumes", volId), { enderecoId: "" });
        loadAll();
    }
};

window.deletarEndereco = async (id) => {
    if(confirm("Excluir este endereço?")){
        await deleteDoc(doc(db, "enderecos", id));
        loadAll();
    }
};

window.logout = () => signOut(auth).then(() => window.location.href = "index.html");
