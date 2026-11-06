// TS 7 起 side-effect import(`import './x.css'`)要求模块声明(TS2882)。
// Next/Webpack 处理 CSS 由构建器负责,类型层只需声明模块存在。
declare module '*.css';
