function addStyles() {
  const modeStyle = document.createElement("style");
  modeStyle.textContent = `
  html.vim-normal-mode p.Paragraph,
  html.vim-normal-mode p.Paragraph * {
    caret-color: transparent !important;
  }
`;
  document.documentElement.appendChild(modeStyle);
}
