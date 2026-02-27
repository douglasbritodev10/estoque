import { db, auth } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { 
    collection, addDoc, getDocs, serverTimestamp, doc, 
    updateDoc, increment, query, orderBy, deleteDoc 
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

let fornecedoresCache = {};

onAuthStateChanged(auth, user => {
    if (user) {
        document.getElementById("labelUser").innerText = `Olá, ${user.email.split('@')[0].toUpperCase()}`;
        init();
    } else { window.location.href = "index.html"; }
});

async function init() {
    const fSnap = await getDocs(query(collection(db, "fornecedores"), orderBy("nome", "asc")));
    const selCadastro = document.getElementById("selForn");
    const selFiltro = document.getElementById("filtroForn");
    
    selCadastro.innerHTML = '<option value="">Selecione...</option>';
    selFiltro.innerHTML = '<option value="">Todos os Fornecedores</option>';

    fSnap.forEach(d => {
        const nome = d.data().nome;
        fornecedoresCache[d.id] = nome;
        selCadastro.innerHTML += `<option value="${d.id}">${nome}</option>`;
        selFiltro.innerHTML += `<option value="${nome}">${nome}</option>`;
    });
    refresh();
}

async function refresh() {
    const tbody = document.getElementById("corpoTabela");
    const pSnap = await getDocs(query(collection(db, "produtos"), orderBy("nome", "asc")));
    const vSnap = await getDocs(collection(db, "volumes"));
    
    tbody.innerHTML = "";
    const volumes = vSnap.docs.map(d => ({id: d.id, ...d.data()}));

    pSnap.forEach(docProd => {
        const p = docProd.data();
        const pId = docProd.id;
        const pVols = volumes.filter(v => v.produtoId === pId);

        const grupos = {};
        pVols.forEach(v => {
            if (!grupos[v.descricao]) grupos[v.descricao] = { total: 0, ids: [] };
            grupos[v.descricao].total += v.quantidade;
            grupos[v.descricao].ids.push(v.id);
        });

        // LINHA DO PRODUTO (BOTÕES ORIGINAIS RESTAURADOS)
        tbody.innerHTML += `
            <tr class="row-prod" data-txt="${p.nome.toLowerCase()} ${p.codigo.toLowerCase()}">
                <td style="text-align:center;"><button onclick="toggleVols('${pId}')" style="cursor:pointer; border:none; background:none; font-weight:bold;">+</button></td>
                <td>${fornecedoresCache[p.fornecedorId] || "---"}</td>
                <td>${p.codigo}</td>
                <td><b>${p.nome}</b></td>
                <td>
                    <button class="btn-action" onclick="addVolume('${pId}', '${p.nome}')" style="background:var(--success); color:white; border:none; padding:4px 8px; border-radius:3px; cursor:pointer; font-size:11px;">+ VOL</button>
                    <button class="btn-action" onclick="deletar('${pId}', 'produtos', '${p.nome}')" style="background:var(--danger); color:white; border:none; padding:4px 8px; border-radius:3px; cursor:pointer; font-size:11px;">EXCLUIR</button>
                </td>
            </tr>
        `;

        Object.keys(grupos).forEach(desc => {
            tbody.innerHTML += `
                <tr class="row-vol child-${pId}" style="display:none; background:#f9f9f9;">
                    <td></td>
                    <td colspan="2" style="text-align:right; color:#666; font-size:11px;">Volume:</td>
                    <td style="font-size:12px;">${desc}</td>
                    <td style="display:flex; align-items:center; gap:10px;">
                        <b style="font-size:14px; color:var(--primary);">${grupos[desc].total}</b>
                        <button onclick="entradaMercadoria('${pId}', '${desc}')" style="background:var(--primary); color:white; border:none; border-radius:3px; cursor:pointer; padding:2px 8px;">ENTRADA (+)</button>
                    </td>
                </tr>
            `;
        });
    });
}

// Lógica de Entrada (Sempre cria novo lote para endereçamento)
window.entradaMercadoria = async (pId, desc) => {
    const qtdStr = prompt(`Quantas unidades novas de "${desc}" chegaram?`, "1");
    const qtd = parseInt(qtdStr);
    if (qtd > 0) {
        await addDoc(collection(db, "volumes"), {
            produtoId: pId,
            descricao: desc,
            quantidade: qtd,
            enderecoId: "" 
        });
        refresh();
    }
};

window.addVolume = async (pId, pNome) => {
    const d = prompt(`Nome do volume (Ex: Lateral):`);
    if(d) {
        await addDoc(collection(db, "volumes"), { produtoId: pId, descricao: d, quantidade: 0, enderecoId: "" });
        refresh();
    }
};

window.deletar = async (id, tabela, desc) => {
    if(confirm(`Excluir "${desc}"?`)) {
        await deleteDoc(doc(db, tabela, id));
        refresh();
    }
};

window.toggleVols = (pId) => {
    document.querySelectorAll(`.child-${pId}`).forEach(el => el.style.display = el.style.display === "none" ? "table-row" : "none");
};

window.logout = () => signOut(auth).then(() => window.location.href = "index.html");
