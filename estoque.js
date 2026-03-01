import { db, auth } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { 
    collection, getDocs, doc, getDoc, addDoc, updateDoc, deleteDoc, query, orderBy, serverTimestamp, increment 
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

let dbState = { fornecedores: {}, produtos: {}, enderecos: [], volumes: [] };
let usernameDB = "Usuário";
let userRole = "leitor";

// --- CONTROLE DE ACESSO ---
onAuthStateChanged(auth, async user => {
    if (user) {
        const userRef = doc(db, "users", user.uid);
        const userSnap = await getDoc(userRef);
        if (userSnap.exists()) {
            const data = userSnap.data();
            usernameDB = data.nomeCompleto || "Usuário";
            userRole = (data.role || "leitor").toLowerCase();
            
            const btnEnd = document.getElementById("btnNovoEnd");
            if(btnEnd) btnEnd.style.display = (userRole === 'admin') ? 'block' : 'none';
        }
        const display = document.getElementById("userDisplay");
        if(display) display.innerHTML = `<i class="fas fa-user-circle"></i> ${usernameDB} (${userRole.toUpperCase()})`;
        
        loadAll(); 
    } else { 
        window.location.href = "index.html"; 
    }
});

// --- CARREGAMENTO DE DADOS ---
async function loadAll() {
    try {
        const [fS, pS, eS, vS] = await Promise.all([
            getDocs(collection(db, "fornecedores")),
            getDocs(collection(db, "produtos")),
            getDocs(query(collection(db, "enderecos"), orderBy("rua"), orderBy("modulo"))),
            getDocs(collection(db, "volumes"))
        ]);

        dbState.fornecedores = {};
        const selForn = document.getElementById("filtroForn");
        if(selForn) selForn.innerHTML = '<option value="">Todos os Fornecedores</option>';
        
        fS.forEach(d => {
            dbState.fornecedores[d.id] = d.data().nome;
            if(selForn) selForn.innerHTML += `<option value="${d.id}">${d.data().nome}</option>`;
        });

        dbState.produtos = {};
        pS.forEach(d => {
            const p = d.data();
            dbState.produtos[d.id] = { 
                nome: p.nome, 
                fornId: p.fornecedorId,
                fornNome: dbState.fornecedores[p.fornecedorId] || "---",
                codigo: p.codigo || "S/C" // Código do Produto Master
            };
        });

        dbState.enderecos = eS.docs.map(d => ({ id: d.id, ...d.data() }));
        dbState.volumes = vS.docs.map(d => ({ id: d.id, ...d.data() }));

        renderizarTudo();
    } catch (e) { console.error("Erro ao carregar dados:", e); }
}

window.filtrarEstoque = () => renderizarTudo();
window.limparFiltros = () => {
    document.getElementById("filtroCod").value = "";
    document.getElementById("filtroForn").value = "";
    document.getElementById("filtroDesc").value = "";
    renderizarTudo();
};

function renderizarTudo() {
    const fCod = document.getElementById("filtroCod").value.toUpperCase();
    const fForn = document.getElementById("filtroForn").value;
    const fDesc = document.getElementById("filtroDesc").value.toUpperCase();

    // 1. Renderizar Pendentes
    const areaPendentes = document.getElementById("listaPendentes");
    const pendentes = dbState.volumes.filter(v => {
        const p = dbState.produtos[v.produtoId] || {};
        const condicao = v.quantidade > 0 && (!v.enderecoId || v.enderecoId === "");
        // Filtro busca no Código Master (p.codigo) ou no SKU do Volume (v.codigo)
        const filtro = (!fCod || p.codigo?.includes(fCod) || v.codigo?.includes(fCod)) &&
                       (!fForn || p.fornId === fForn) &&
                       (!fDesc || p.nome?.includes(fDesc) || v.descricao?.includes(fDesc));
        return condicao && filtro;
    });

    document.getElementById("countPendentes").innerText = pendentes.length;
    areaPendentes.innerHTML = pendentes.map(v => {
        const p = dbState.produtos[v.produtoId] || {nome: "Produto não encontrado", fornNome: "---", codigo: "---"};
        return `
            <div class="vol-item-pendente" style="background:rgba(255,255,255,0.05); padding:10px; border-radius:8px; margin-bottom:10px; border-left:4px solid var(--warning); display:flex; justify-content:space-between; align-items:center;">
                <div style="flex:1">
                    <small style="color:var(--warning)">${p.fornNome} | <b>M: ${p.codigo}</b></small><br>
                    <strong style="color:white; font-size:12px;">${p.nome}</strong><br>
                    <small style="color:#aaa;">SKU: <b>${v.codigo}</b> | ${v.descricao} | Qtd: ${v.quantidade}</small>
                </div>
                ${userRole !== 'leitor' ? `<button onclick="window.abrirModalMover('${v.id}')" class="btn-mover">GUARDAR</button>` : ''}
            </div>
        `;
    }).join('');

    // 2. Renderizar Endereços (Grid Central)
    const grid = document.getElementById("gridEnderecos");
    grid.innerHTML = "";
    let totalItensVisiveis = 0;

    dbState.enderecos.forEach(end => {
        const volsNoEndereco = dbState.volumes.filter(v => {
            const p = dbState.produtos[v.produtoId] || {};
            const noLocal = v.enderecoId === end.id && v.quantidade > 0;
            const filtro = (!fCod || p.codigo?.includes(fCod) || v.codigo?.includes(fCod)) &&
                           (!fForn || p.fornId === fForn) &&
                           (!fDesc || p.nome?.includes(fDesc) || v.descricao?.includes(fDesc));
            return noLocal && filtro;
        });

        if (volsNoEndereco.length > 0 || (!fCod && !fForn && !fDesc)) {
            totalItensVisiveis++;
            const card = document.createElement('div');
            card.className = "card-endereco";
            
            let htmlVols = volsNoEndereco.map(v => {
                const p = dbState.produtos[v.produtoId] || {nome:"---", fornNome:"---", codigo: "---"};
                return `
                    <div class="vol-item">
                        <div style="flex:1">
                            <small><b>${p.fornNome}</b> | M: <b>${p.codigo}</b></small><br>
                            <strong>${p.nome}</strong><br>
                            <small>SKU: <b>${v.codigo}</b> | ${v.descricao} | Qtd: ${v.quantidade}</small>
                        </div>
                        ${userRole !== 'leitor' ? `
                            <div class="actions">
                                <button onclick="window.abrirModalMover('${v.id}')" title="Mover"><i class="fas fa-exchange-alt"></i></button>
                                <button onclick="window.darSaida('${v.id}', '${v.descricao}', ${v.quantidade})" style="color:var(--danger)" title="Saída"><i class="fas fa-sign-out-alt"></i></button>
                            </div>
                        ` : ''}
                    </div>`;
            }).join('');

            card.innerHTML = `
                <div class="card-header">
                    RUA ${end.rua} - MOD ${end.modulo}
                    ${userRole === 'admin' ? `<i class="fas fa-trash" onclick="window.deletarLocal('${end.id}')" style="float:right; cursor:pointer; opacity:0.7;"></i>` : ''}
                </div>
                <div style="flex:1">${htmlVols || '<div style="text-align:center; padding:15px; color:#999; font-style:italic;">Vazio</div>'}</div>
            `;
            grid.appendChild(card);
        }
    });
    document.getElementById("countDisplay").innerText = totalItensVisiveis;
}

// --- FUNÇÕES DE MODAL, MOVIMENTAÇÃO E SAÍDA (ORIGINAIS MANTIDAS) ---
function openModalBase(title, html, confirmAction) {
    document.getElementById("modalTitle").innerText = title;
    document.getElementById("modalBody").innerHTML = html;
    document.getElementById("modalMaster").style.display = "flex";
    const btnConfirm = document.querySelector("#modalMaster .btn-primary");
    if(btnConfirm) { btnConfirm.onclick = confirmAction; }
}

window.abrirModalNovoEnd = () => {
    if(userRole !== 'admin') return;
    openModalBase("Novo Endereço", `
        <label>Rua:</label><input type="text" id="newRua" style="width:100%; margin-bottom:10px;" placeholder="Ex: A">
        <label>Módulo:</label><input type="number" id="newMod" style="width:100%;" placeholder="Ex: 10">
    `, window.salvarEndereco);
};

window.salvarEndereco = async () => {
    const rua = document.getElementById("newRua").value.toUpperCase();
    const mod = parseInt(document.getElementById("newMod").value);
    if(rua && mod) {
        await addDoc(collection(db, "enderecos"), { rua, modulo: mod });
        window.fecharModal();
        loadAll();
    } else { alert("Preencha todos os campos!"); }
};

window.abrirModalMover = (volId) => {
    const vol = dbState.volumes.find(v => v.id === volId);
    const p = dbState.produtos[vol.produtoId];
    openModalBase("Movimentar Volume", `
        <input type="hidden" id="modalVolId" value="${volId}">
        <p style="font-size:13px; margin-bottom:15px;">Item: <b>${p.nome}</b><br>SKU: ${vol.codigo}</p>
        <label>Quantidade a mover:</label>
        <input type="number" id="qtdMover" value="${vol.quantidade}" max="${vol.quantidade}" style="width:100%; margin-bottom:15px;">
        <label>Destino:</label>
        <select id="selDestino" style="width:100%;">
            <option value="">-- Selecione o Endereço --</option>
            ${dbState.enderecos.map(e => `<option value="${e.id}">RUA ${e.rua} - MOD ${e.modulo}</option>`).join('')}
        </select>
    `, window.confirmarMovimento);
};

window.confirmarMovimento = async () => {
    const volId = document.getElementById("modalVolId").value;
    const destId = document.getElementById("selDestino").value;
    const qtd = parseInt(document.getElementById("qtdMover").value);
    if(!destId || qtd <= 0) return alert("Selecione um destino válido!");
    const vol = dbState.volumes.find(v => v.id === volId);
    const existente = dbState.volumes.find(v => v.enderecoId === destId && v.produtoId === vol.produtoId && v.codigo === vol.codigo);
    try {
        if(existente) { await updateDoc(doc(db, "volumes", existente.id), { quantidade: increment(qtd) }); } 
        else { const novoVol = {...vol}; delete novoVol.id; await addDoc(collection(db, "volumes"), { ...novoVol, quantidade: qtd, enderecoId: destId }); }
        if(qtd === vol.quantidade) { await deleteDoc(doc(db, "volumes", volId)); } 
        else { await updateDoc(doc(db, "volumes", volId), { quantidade: increment(-qtd) }); }
        window.fecharModal();
        loadAll();
    } catch(e) { alert("Erro na movimentação"); }
};

window.darSaida = async (id, desc, qtdAtual) => {
    const q = prompt(`BAIXA DE ESTOQUE: ${desc}\nQtd disponível: ${qtdAtual}\nDigite a quantidade de saída:`);
    const qtd = parseInt(q);
    if(qtd > 0 && qtd <= qtdAtual) {
        if(qtd === qtdAtual) await deleteDoc(doc(db, "volumes", id));
        else await updateDoc(doc(db, "volumes", id), { quantidade: increment(-qtd) });
        loadAll();
    } else if (q !== null) { alert("Quantidade inválida!"); }
};

window.deletarLocal = async (id) => {
    if(userRole !== 'admin') return;
    const temItens = dbState.volumes.some(v => v.enderecoId === id && v.quantidade > 0);
    if(temItens) return alert("Não é possível excluir um endereço que contém produtos!");
    if(confirm("Deseja excluir este local permanentemente?")) { await deleteDoc(doc(db, "enderecos", id)); loadAll(); }
};

window.fecharModal = () => document.getElementById("modalMaster").style.display = "none";
window.logout = () => signOut(auth).then(() => window.location.href = "index.html");
