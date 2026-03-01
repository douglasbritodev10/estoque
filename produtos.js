import { db, auth } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { 
    collection, addDoc, getDocs, serverTimestamp, doc, getDoc,
    updateDoc, deleteDoc, increment, query, where 
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

let fornecedoresCache = {};
let userRole = "leitor";
let usernameDB = "Usuário";

// --- AUTH E PERMISSÕES ---
onAuthStateChanged(auth, async user => {
    if (user) {
        const userSnap = await getDoc(doc(db, "users", user.uid));
        if (userSnap.exists()) {
            const d = userSnap.data();
            userRole = (d.role || "leitor").toLowerCase();
            usernameDB = d.nomeCompleto || "Usuário";
            
            if(userRole === "admin") {
                const btnProd = document.getElementById("btnAbrirModalProd");
                if(btnProd) btnProd.style.display = "block";
            }
        }
        document.getElementById("userDisplay").innerHTML = `<i class="fas fa-user-shield"></i> ${usernameDB}`;
        init();
    } else { window.location.href = "index.html"; }
});

async function init() {
    const fSnap = await getDocs(collection(db, "fornecedores"));
    const selForn = document.getElementById("filtroForn");
    selForn.innerHTML = '<option value="">Todos os Fornecedores</option>';
    fSnap.forEach(d => {
        fornecedoresCache[d.id] = d.data().nome;
        selForn.innerHTML += `<option value="${d.id}">${d.data().nome}</option>`;
    });
    renderizar();
}

window.filtrar = () => renderizar();
window.limparFiltros = () => { location.reload(); };

// --- RENDERIZAÇÃO COM CONSOLIDAÇÃO E BOTÕES DE EDIÇÃO ---
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
        
        let volsAgrupados = {};
        vSnap.forEach(vDoc => {
            const v = vDoc.data();
            if(v.produtoId === pId) {
                const sku = v.codigo.trim().toUpperCase();
                if(!volsAgrupados[sku]) {
                    volsAgrupados[sku] = { idOriginal: vDoc.id, codigo: v.codigo, descricao: v.descricao, quantidade: 0 };
                }
                volsAgrupados[sku].quantidade += (v.quantidade || 0);
            }
        });

        const listaVols = Object.values(volsAgrupados);
        const totalGeral = listaVols.reduce((acc, v) => acc + v.quantidade, 0);

        if ((!fForn || p.fornecedorId === fForn) && 
            (!fDesc || p.nome.toUpperCase().includes(fDesc)) &&
            (!fCod || p.codigo.toUpperCase().includes(fCod) || listaVols.some(v => v.codigo.toUpperCase().includes(fCod)))) {

            // LINHA DO PRODUTO (MASTER)
            tbody.innerHTML += `
                <tr data-id="${pId}">
                    <td onclick="window.toggleVols('${pId}')" style="cursor:pointer; text-align:center;"><i class="fas fa-chevron-right"></i></td>
                    <td>${fornecedoresCache[p.fornecedorId] || '---'}</td>
                    <td><b>${p.codigo || '---'}</b></td>
                    <td>${p.nome}</td>
                    <td style="text-align:center"><strong>${totalGeral}</strong></td>
                    <td style="text-align:right">
                        <button class="btn-action" style="background:var(--info)" onclick="window.modalNovoSKU('${pId}', '${p.nome}')">CRIAR SKU</button>
                        ${userRole === 'admin' ? `
                            <button class="btn-action" style="background:var(--warning)" onclick="window.modalEditarProd('${pId}', '${p.nome}', '${p.codigo}', '${p.fornecedorId}')"><i class="fas fa-edit"></i></button>
                            <button class="btn-action" style="background:var(--danger)" onclick="window.deletar('${pId}', 'produtos', '${p.nome}')"><i class="fas fa-trash"></i></button>
                        ` : ''}
                    </td>
                </tr>
            `;

            // LINHAS DOS VOLUMES (FILHOS)
            listaVols.forEach(v => {
                tbody.innerHTML += `
                    <tr class="child-row child-${pId}">
                        <td></td>
                        <td colspan="2" style="font-size:0.8rem; color:var(--primary); padding-left:20px;">↳ SKU: ${v.codigo}</td>
                        <td style="font-size:0.8rem;">${v.descricao}</td>
                        <td style="text-align:center; font-weight:bold; background:#f0f9ff;">${v.quantidade}</td>
                        <td style="text-align:right">
                            <button class="btn-action" style="background:var(--success)" onclick="window.modalEntrada('${v.idOriginal}', '${v.descricao}')">ENTRADA</button>
                            ${userRole === 'admin' ? `
                                <button class="btn-action" style="background:var(--warning)" onclick="window.modalEditarVolume('${v.idOriginal}', '${v.codigo}', '${v.descricao}')"><i class="fas fa-edit"></i></button>
                                <button class="btn-action" style="background:var(--danger)" onclick="window.deletar('${v.idOriginal}', 'volumes', '${v.descricao}')"><i class="fas fa-times"></i></button>
                            ` : ''}
                        </td>
                    </tr>
                `;
            });
        }
    });
}

// --- FUNÇÃO PARA CRIAR NOVO PRODUTO MASTER (SOLUÇÃO DO BOTÃO) ---
window.modalNovoProduto = () => {
    let opts = '<option value="">Selecione um Fornecedor...</option>';
    Object.entries(fornecedoresCache).forEach(([fid, fnome]) => {
        opts += `<option value="${fid}">${fnome}</option>`;
    });

    openModal("Novo Produto Master", `
        <label>Fornecedor:</label>
        <select id="nP_Forn">${opts}</select>
        <label>Código Master (SKU):</label>
        <input type="text" id="nP_Cod" placeholder="Ex: ABC-123">
        <label>Descrição do Produto:</label>
        <input type="text" id="nP_Nome" placeholder="Ex: Cadeira Gamer">
    `, async () => {
        const fornId = document.getElementById("nP_Forn").value;
        const cod = document.getElementById("nP_Cod").value.trim().toUpperCase();
        const nome = document.getElementById("nP_Nome").value.trim().toUpperCase();

        if(!fornId || !cod || !nome) {
            alert("Preencha todos os campos!");
            return;
        }

        // Validação de Duplicidade de Produto Master
        const q = query(collection(db, "produtos"), where("codigo", "==", cod));
        const check = await getDocs(q);
        if(!check.empty) {
            alert("Erro: Já existe um Produto Master cadastrado com este Código!");
            return;
        }

        try {
            await addDoc(collection(db, "produtos"), {
                fornecedorId: fornId,
                codigo: cod,
                nome: nome,
                dataCriacao: serverTimestamp()
            });
            fecharModal(); renderizar();
        } catch (e) { alert("Erro ao salvar."); }
    });
};

// --- MODAIS DE EDIÇÃO (EXCLUSIVO ADMIN) ---

window.modalEditarProd = (id, nome, cod, fornId) => {
    let opts = "";
    Object.entries(fornecedoresCache).forEach(([fid, fnome]) => {
        opts += `<option value="${fid}" ${fid === fornId ? 'selected' : ''}>${fnome}</option>`;
    });

    openModal("Editar Produto", `
        <label>Fornecedor:</label><select id="eForn">${opts}</select>
        <label>Código:</label><input type="text" id="eCod" value="${cod}">
        <label>Nome:</label><input type="text" id="eNome" value="${nome}">
    `, async () => {
        await updateDoc(doc(db, "produtos", id), {
            fornecedorId: document.getElementById("eForn").value,
            codigo: document.getElementById("eCod").value,
            nome: document.getElementById("eNome").value.toUpperCase()
        });
        fecharModal(); renderizar();
    });
};

window.modalEditarVolume = (id, sku, desc) => {
    openModal("Editar SKU / Volume", `
        <label>Código SKU:</label><input type="text" id="eSKU" value="${sku}">
        <label>Descrição:</label><input type="text" id="eDesc" value="${desc}">
    `, async () => {
        await updateDoc(doc(db, "volumes", id), {
            codigo: document.getElementById("eSKU").value,
            descricao: document.getElementById("eDesc").value.toUpperCase()
        });
        fecharModal(); renderizar();
    });
};

// --- OUTROS MODAIS ---

window.modalNovoSKU = (pId, pNome) => {
    openModal(`Novo SKU: ${pNome}`, `
        <label>SKU:</label><input type="text" id="nSKU">
        <label>Descrição:</label><input type="text" id="nDesc">
        <label>Qtd Inicial:</label><input type="number" id="nQtd" value="0">
    `, async () => {
        const sku = document.getElementById("nSKU").value.trim().toUpperCase();
        
        // Validação de Duplicidade de SKU (Volume)
        const q = query(collection(db, "volumes"), where("codigo", "==", sku));
        const check = await getDocs(q);
        if(!check.empty) {
            alert("Erro: Este SKU já está em uso em outro volume!");
            return;
        }

        await addDoc(collection(db, "volumes"), {
            produtoId: pId, 
            codigo: sku,
            descricao: document.getElementById("nDesc").value.toUpperCase(),
            quantidade: parseInt(document.getElementById("nQtd").value),
            enderecoId: "", dataAlt: serverTimestamp()
        });
        fecharModal(); renderizar();
    });
};

window.modalEntrada = (vId, vDesc) => {
    openModal(`Entrada: ${vDesc}`, `<label>Quantidade:</label><input type="number" id="addQ" value="1">`, async () => {
        const q = parseInt(document.getElementById("addQ").value);
        await updateDoc(doc(db, "volumes", vId), { quantidade: increment(q), dataAlt: serverTimestamp() });
        await addDoc(collection(db, "movimentacoes"), { tipo: "Entrada", produto: vDesc, quantidade: q, usuario: usernameDB, data: serverTimestamp() });
        fecharModal(); renderizar();
    });
};

// --- AUXILIARES ---
function openModal(title, body, action) {
    document.getElementById("modalTitle").innerText = title;
    document.getElementById("modalBody").innerHTML = body;
    document.getElementById("modalMaster").style.display = "flex";
    document.getElementById("btnModalConfirm").onclick = action;
}
window.fecharModal = () => document.getElementById("modalMaster").style.display = "none";
window.toggleVols = (pId) => {
    const rows = document.querySelectorAll(`.child-${pId}`);
    rows.forEach(r => r.classList.toggle('active'));
};
window.deletar = async (id, tab, desc) => {
    if(confirm(`Excluir "${desc}"?`)) { await deleteDoc(doc(db, tab, id)); renderizar(); }
};
window.logout = () => signOut(auth).then(() => window.location.href = "index.html");
