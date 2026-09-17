function addStyles() {
  const modeStyle = document.createElement("style");
  modeStyle.textContent = `
  html.vim-normal-mode #PagesContainer,
  html.vim-normal-mode body {
    caret-color: transparent !important;
  }
`;
  document.documentElement.appendChild(modeStyle);
}
