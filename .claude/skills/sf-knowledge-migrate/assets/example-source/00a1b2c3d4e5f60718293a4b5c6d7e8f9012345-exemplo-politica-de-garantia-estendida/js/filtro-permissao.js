// Script de filtro por permissão do Wiki de origem (fictício).
// Esconde/mostra blocos do artigo conforme a permissão do usuário logado
// na plataforma de Wiki de origem. Este script NUNCA deve sobreviver à
// conversão: ele depende do DOM e da sessão daquele Wiki específico, e não
// tem sentido nenhum fora dele. convert.js remove todo <script> por padrão.
(function () {
  window.__permissoesUsuario = [];
  function aplicarFiltro(permissoesUsuario) {
    window.__permissoesUsuario = Array.isArray(permissoesUsuario) ? permissoesUsuario : [];
    var nodes = document.querySelectorAll('[component-permissions]');
    nodes.forEach(function (el) {
      var raw = el.getAttribute('component-permissions') || '';
      var required = raw.split(',').map(function (p) { return p.trim(); }).filter(Boolean);
      if (required.length === 0) { el.style.display = ''; return; }
      var hasPermission = required.some(function (perm) {
        return window.__permissoesUsuario.includes(perm);
      });
      el.style.display = hasPermission ? '' : 'none';
    });
  }
  window.applyPermissoesUsuario = function (permissoesUsuario) {
    aplicarFiltro(permissoesUsuario);
  };
})();
