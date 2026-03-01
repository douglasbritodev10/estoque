import { db, auth } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { 
    collection, addDoc, getDocs, serverTimestamp, doc, getDoc,
    updateDoc, deleteDoc, increment 
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

let fornecedoresCache = {};
let userRole = "leitor";
let usernameDB = "Usuário";

// --- CONTROLE DE ACESSO E AUTH ---
onAuthStateChanged(auth, async user => {
    if (user) {
        const userSnap = await getDoc(doc(db, "users", user.uid));
        if (userSnap.exists()) {
            const d = userSnap.data();
            userRole = (d.role || "leitor").toLowerCase();
            usernameDB = d.nomeCompleto || "Usuário";
            
            // Exibe botão de novo produto apenas para Admin
            const btnProd = document.getElementById("btnAbrirModalProd");
            if(btnProd && userRole === "admin") btnProd.style.display = "block";
        }
        document.getElementById("userDisplay").innerHTML = `<i class="fas fa-user-circle"></i> ${usernameDB}`;
        
        // Recuperar filtros salvos para não perder a busca ao recarregar
        document.getElementById("filtroForn").value = localStorage.getItem("f_forn") || "";
        document.getElementById("filtroCod").value = localStorage.getItem("f_cod") || "";
        document.getElementById("filtroDesc").value = localStorage.getItem("f_desc") || "";
        
        init();
    } else { 
        window.location.href = "index.html"; 
    }
});

async function init() {
    // Carregar Fornecedores para o Cache e Select
    const fSnap = await getDocs(collection(db, "fornecedores"));
    const selForn = document.getElementById("filtroForn");
    selForn.innerHTML = '<option value="">Todos os Fornecedores</option>';
    
    fSnap.forEach(d => {
        fornecedoresCache[d.id] = d.data().nome;
        selForn.innerHTML += `<option value="${d.id}">${d.data().nome}</option>`;
    });
    
    renderizar();
}

// --- SISTEMA DE FILTROS ---
window.filtrar = () => {
    localStorage.setItem("f_forn", document.getElementById("filtroForn").value);
    localStorage.setItem("f_cod", document.getElementById("filtroCod").value);
    localStorage.setItem("f_desc", document.getElementById("filtroDesc").value);
    renderizar();
};

window.limparFiltros = () => {
    localStorage.clear();
    location.reload();
};

// --- RENDERIZAÇÃO COM JUNÇÃO DE VOLUMES (CONSOLIDAÇÃO) ---
async function renderizar() {
    const fForn = document.getElementById("filtroForn").value;
    const fCod = document.getElementById("filtroCod").value.toUpperCase();
    const fDesc = document.getElementById("filtroDesc").value.toUpperCase();

    const [pSnap, vSnap] = await Promise.all([
        getDocs(collection(db, "produtos")),
        getDocs(collection(db, "volumes"))
    ]);

    const tbody = document.getElementById("tblEstoque");
    tbody.innerHTML = "";

    pSnap.forEach(docP => {
        const p = docP.data();
        const pId = docP.id;
        
        // Agrupar volumes pelo código SKU para somar as quantidades
        let volsAgrupados = {};
        vSnap.forEach(vDoc => {
            const v = vDoc.data();
            if(v.produtoId === pId) {
                const sku = v.codigo.trim().toUpperCase();
                if(!volsAgrupados[sku]) {
                    volsAgrupados[sku] = {
                        primeiroId: vDoc.id, // Referência para atualização
                        codigo: v.codigo,
                        descricao: v.descricao,
                        quantidade: 0
                    };
                }
                volsAgrupados[sku].quantidade += (v.quantidade || 0);
            }
        });

        const listaVols = Object.values(volsAgrupados);
        const totalGeral = listaVols.reduce((acc, v) => acc + v.quantidade, 0);

        // Aplicação dos Filtros
        const matchForn = !fForn || p.fornecedorId === fForn;
        const matchDesc = !fDesc || p.nome.toUpperCase().includes(fDesc);
        const matchCod = !fCod || p.codigo.toUpperCase().includes(fCod) || listaVols.some(v => v.codigo.toUpperCase().includes(fCod));

        if (matchForn && matchCod && matchDesc) {
            // Linha do Produto Master
            tbody.innerHTML += `
                <tr data-id="${pId}">
                    <td onclick="window.toggleVols('${pId}')" style="cursor:pointer; text-align:center; color:var(--primary)">
                        <i class="fas fa-chevron-right"></i>
                    </td>
                    <td>${fornecedoresCache[p.fornecedorId] || '---'}</td>
                    <td><b>${p.codigo || '---'}</b></td>
                    <td>${p.nome}</td>
                    <td style="text-align:center"><strong>${totalGeral}</strong></td>
                    <td style="text-align:right">
                        ${userRole === 'admin' ? `
                            <button class="btn-action" style="background:var(--info)" onclick="window.modalNovoSKU('${pId}', '${p.nome}')">CRIAR SKU</button>
                            <button class="btn-action" style="background:var(--danger); margin-left:5px;" onclick="window.deletar('${pId}', 'produtos', '${p.nome}')"><i class="fas fa-trash"></i></button>
                        ` : ''}
                    </td>
                </tr>
            `;

            // Linhas dos Volumes Consolidados
            listaVols.forEach(v => {
                tbody.innerHTML += `
                    <tr class="child-row child-${pId}">
                        <td></td>
                        <td colspan="2" style="font-size:0.8rem; color:var(--primary); padding-left:20px;">↳ SKU: ${v.codigo}</td>
                        <td style="font-size:0.8rem; color:#555;">${v.descricao}</td>
                        <td style="text-align:center; font-size:0.9rem; font-weight:bold; background:#f0f9ff;">${v.quantidade}</td>
                        <td style="text-align:right">
                            <button class="btn-action" style="background:var(--success)" onclick="window.modalEntrada('${v.primeiroId}', '${v.descricao}')">ENTRADA</button>
                            ${userRole === 'admin' ? `
                                <button onclick="window.deletar('${v.primeiroId}', 'volumes', '${v.descricao}')" style="border:none; background:none; color:var(--danger); cursor:pointer; margin-left:10px;"><i class="fas fa-times"></i></button>
                            ` : ''}
                        </td>
                    </tr>
                `;
            });
        }
    });
}

// --- FUNÇÕES DE MOVIMENTAÇÃO E CADASTRO ---

window.modalNovoProduto = () => {
    let opts = '<option value="">Escolha um fornecedor...</option>';
    Object.entries(fornecedoresCache).forEach(([id, nome]) => opts += `<option value="${id}">${nome}</option>`);

    abrirModalMaster("Novo Produto", `
        <label>Fornecedor:</label><select id="mForn">${opts}</select>
        <label>Código Master:</label><input type="text" id="mCod">
        <label>Nome do Produto:</label><input type="text" id="mNome">
    `, async () => {
        const f = document.getElementById("mForn").value;
        const n = document.getElementById("mNome").value.toUpperCase();
        const c = document.getElementById("mCod").value;
        if(!f || !n) return alert("Preencha Fornecedor e Nome!");
        await addDoc(collection(db, "produtos"), { fornecedorId: f, nome: n, codigo: c, dataCad: serverTimestamp() });
        fecharModal(); renderizar();
    });
};

window.modalNovoSKU = (pId, pNome) => {
    abrirModalMaster(`Novo SKU para: ${pNome}`, `
        <label>Código SKU (Volume):</label><input type="text" id="nSKU">
        <label>Descrição/Especificação:</label><input type="text" id="nDesc">
        <label>Qtd Inicial:</label><input type="number" id="nQtd" value="0">
    `, async () => {
        const sku = document.getElementById("nSKU").value;
        const desc = document.getElementById("nDesc").value.toUpperCase();
        const qtd = parseInt(document.getElementById("nQtd").value);
        await addDoc(collection(db, "volumes"), {
            produtoId: pId, codigo: sku, descricao: desc, quantidade: qtd, enderecoId: "", dataAlt: serverTimestamp()
        });
        fecharModal(); renderizar();
    });
};

window.modalEntrada = (vId, vDesc) => {
    abrirModalMaster(`Entrada: ${vDesc}`, `
        <label>Quantidade a adicionar:</label>
        <input type="number" id="addQtd" value="1" min="1">
    `, async () => {
        const qtd = parseInt(document.getElementById("addQtd").value);
        if(qtd <= 0) return;
        
        await updateDoc(doc(db, "volumes", vId), { 
            quantidade: increment(qtd), 
            dataAlt: serverTimestamp() 
        });

        await addDoc(collection(db, "movimentacoes"), {
            tipo: "Entrada", produto: vDesc, quantidade: qtd, usuario: usernameDB, data: serverTimestamp()
        });

        fecharModal(); renderizar();
    });
};

// --- AUXILIARES DE INTERFACE ---

function abrirModalMaster(titulo, corpo, acao) {
    document.getElementById("modalTitle").innerText = titulo;
    document.getElementById("modalBody").innerHTML = corpo;
    document.getElementById("modalMaster").style.display = "flex";
    document.getElementById("btnModalConfirm").onclick = acao;
}

window.fecharModal = () => document.getElementById("modalMaster").style.display = "none";

window.toggleVols = (pId) => {
    const rows = document.querySelectorAll(`.child-${pId}`);
    const icon = document.querySelector(`tr[data-id="${pId}"] i`);
    rows.forEach(r => r.classList.toggle('active'));
    if(icon) icon.className = rows[0]?.classList.contains('active') ? "fas fa-chevron-down" : "fas fa-chevron-right";
};

window.deletar = async (id, tabela, desc) => {
    if(userRole !== 'admin') return;
    if(confirm(`Eliminar permanentemente "${desc}"?`)){
        await deleteDoc(doc(db, tabela, id));
        renderizar();
    }
};

window.logout = () => signOut(auth).then(() => window.location.href = "index.html");
