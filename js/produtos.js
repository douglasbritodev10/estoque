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
    // Busca fornecedores em ordem de A-Z
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

    // Recupera filtros individuais para não perder ao recarregar
    document.getElementById("filtroCod").value = localStorage.getItem('f_assist_cod') || "";
    document.getElementById("filtroForn").value = localStorage.getItem('f_assist_forn') || "";
    document.getElementById("filtroDesc").value = localStorage.getItem('f_assist_desc') || "";

    refresh();
}

async function refresh() {
    const tbody = document.getElementById("corpoTabela");
    const pSnap = await getDocs(query(collection(db, "produtos"), orderBy("nome", "asc")));
    const vSnap = await getDocs(collection(db, "volumes"));
    const vols = vSnap.docs.map(d => ({id: d.id, ...d.data()}));

    tbody.innerHTML = "";

    pSnap.forEach(dp => {
        const p = dp.data();
        const pId = dp.id;
        const nForn = fornecedoresCache[p.fornecedorId] || "---";
        const vDesteProd = vols.filter(v => v.produtoId === pId);
        const qtdTotal = vDesteProd.reduce((acc, curr) => acc + curr.quantidade, 0);

        // String para busca avançada (inclui nomes dos volumes no pai)
        const nomesVolumes = vDesteProd.map(v => v.descricao).join(" ").toLowerCase();

        const tr = document.createElement('tr');
        tr.className = "row-prod";
        // Armazena dados para o filtro cascata
        tr.dataset.cod = (p.codigo || "").toLowerCase();
        tr.dataset.forn = nForn;
        tr.dataset.desc = `${p.nome} ${nomesVolumes}`.toLowerCase();
        
        tr.innerHTML = `
            <td style="text-align:center; cursor:pointer; color:var(--primary)" onclick="window.toggleVols('${pId}')">▼</td>
            <td>${nForn}</td>
            <td>${p.codigo}</td>
            <td>${p.nome}</td>
            <td style="text-align:center"><strong>${qtdTotal}</strong></td>
            <td style="text-align:right">
                <button class="btn-action" style="background:var(--success)" onclick="window.addVolume('${pId}', '${p.nome}')">+ Volume</button>
                <button class="btn-action" style="background:var(--warning)" onclick="window.editarItem('${pId}', 'produtos', '${p.nome}')">✎</button>
                <button class="btn-action" style="background:var(--danger)" onclick="window.deletar('${pId}', 'produtos', '${p.nome}')">Excluir</button>
            </td>
        `;
        tbody.appendChild(tr);

        vDesteProd.forEach(v => {
            const trV = document.createElement('tr');
            trV.className = `row-vol child-${pId}`; // Removido 'active' para vir fechado por padrão
            trV.innerHTML = `
                <td></td>
                <td colspan="3" class="indent">↳ ${v.descricao}</td>
                <td style="text-align:center; font-weight:bold;">${v.quantidade}</td>
                <td style="text-align:right">
                    <button class="btn-action" style="background:var(--success)" onclick="window.movimentar('${v.id}', '${v.descricao}', 'Entrada')">▲</button>
                    <button class="btn-action" style="background:var(--danger)" onclick="window.movimentar('${v.id}', '${v.descricao}', 'Saída')">▼</button>
                    <button class="btn-action" style="background:var(--warning); margin-left:15px" onclick="window.editarItem('${v.id}', 'volumes', '${v.descricao}')">✎</button>
                    <button class="btn-action" style="background:var(--gray)" onclick="window.deletar('${v.id}', 'volumes', '${v.descricao}')">✕</button>
                </td>
            `;
            tbody.appendChild(trV);
        });
    });
    window.filtrar();
}

window.filtrar = () => {
    const fCod = document.getElementById("filtroCod").value.toLowerCase();
    const fForn = document.getElementById("filtroForn").value;
    const fDesc = document.getElementById("filtroDesc").value.toLowerCase();

    // Persiste os valores
    localStorage.setItem('f_assist_cod', fCod);
    localStorage.setItem('f_assist_forn', fForn);
    localStorage.setItem('f_assist_desc', fDesc);

    document.querySelectorAll(".row-prod").forEach(rp => {
        const matchesCod = rp.dataset.cod.includes(fCod);
        const matchesForn = fForn === "" || rp.dataset.forn === fForn;
        const matchesDesc = rp.dataset.desc.includes(fDesc);

        if (matchesCod && matchesForn && matchesDesc) {
            rp.style.display = "";
        } else {
            rp.style.display = "none";
            // Fecha os volumes se o pai estiver escondido
            const pId = rp.querySelector('td').getAttribute('onclick').match(/'([^']+)'/)[1];
            document.querySelectorAll(`.child-${pId}`).forEach(c => c.classList.remove('active'));
        }
    });
};

window.limparFiltros = () => {
    document.getElementById("filtroCod").value = "";
    document.getElementById("filtroForn").value = "";
    document.getElementById("filtroDesc").value = "";
    window.filtrar();
};

window.toggleVols = (pId) => {
    document.querySelectorAll(`.child-${pId}`).forEach(el => el.classList.toggle('active'));
};

// --- RESTANTE DAS FUNÇÕES (MOVIMENTAÇÃO, EDIÇÃO, LOGOUT) ---
// (Mantidas conforme seu original para garantir funcionalidade)

window.editarItem = async (id, tabela, valorAtual) => {
    const novo = prompt("Editar descrição:", valorAtual);
    if (novo && novo !== valorAtual) {
        const campo = tabela === 'produtos' ? 'nome' : 'descricao';
        await updateDoc(doc(db, tabela, id), { [campo]: novo });
        await addDoc(collection(db, "movimentacoes"), {
            produto: `Edição: ${valorAtual} -> ${novo}`,
            tipo: "Edição", quantidade: 0, usuario: auth.currentUser.email, data: serverTimestamp()
        });
        refresh();
    }
};

window.movimentar = async (id, desc, tipo) => {
    const q = prompt(`Quantidade de ${tipo} (${desc}):`, "1");
    if (!q || isNaN(q)) return;
    const valor = tipo === 'Entrada' ? parseInt(q) : -parseInt(q);
    await updateDoc(doc(db, "volumes", id), { quantidade: increment(valor), ultimaMovimentacao: serverTimestamp() });
    await addDoc(collection(db, "movimentacoes"), {
        produto: desc, tipo, quantidade: parseInt(q), usuario: auth.currentUser.email, data: serverTimestamp()
    });
    refresh();
};

window.addVolume = async (pId, pNome) => {
    const d = prompt(`Nome do Volume para ${pNome}: (Ex: Lateral Direita)`);
    if(d) {
        await addDoc(collection(db, "volumes"), { produtoId: pId, descricao: d, quantidade: 0, ultimaMovimentacao: serverTimestamp() });
        await addDoc(collection(db, "movimentacoes"), {
            produto: `Novo Volume: ${d} em ${pNome}`, tipo: "Entrada", quantidade: 0, usuario: auth.currentUser.email, data: serverTimestamp()
        });
        refresh();
    }
};

window.deletar = async (id, tabela, descricao) => {
    if(confirm(`Deseja realmente excluir "${descricao}"?`)){
        await deleteDoc(doc(db, tabela, id));
        await addDoc(collection(db, "movimentacoes"), {
            produto: descricao, tipo: "Exclusão", quantidade: 0, usuario: auth.currentUser.email, data: serverTimestamp()
        });
        refresh();
    }
};

document.getElementById("btnSaveProd").onclick = async () => {
    const n = document.getElementById("newNome").value;
    const c = document.getElementById("newCod").value;
    const f = document.getElementById("selForn").value;
    if(!n || !f) return alert("Preencha Nome e Fornecedor!");
    await addDoc(collection(db, "produtos"), { nome: n, codigo: c || "S/C", fornecedorId: f, dataCadastro: serverTimestamp() });
    await addDoc(collection(db, "movimentacoes"), {
        produto: `Cadastro: ${n}`, tipo: "Entrada", quantidade: 0, usuario: auth.currentUser.email, data: serverTimestamp()
    });
    location.reload();
};

window.logout = () => signOut(auth).then(() => window.location.href = "index.html");
