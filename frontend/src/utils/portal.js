import { createPortal } from 'react-dom';

/**
 * 把弹窗 / 抽屉渲染到 document.body 下
 *
 * 遮罩层 `.gm-overlay` 用 `position: fixed` 铺满窗口，但只要某个祖先元素带 `transform`
 * （例如入场动画），fixed 就会改为相对那个祖先定位：弹窗会以整个长列表为基准居中，
 * 账号一多就跑到页面下方。渲染到 body 下可彻底避开祖先样式的影响。
 *
 * 用法：`return renderInBody(<div className="gm-overlay">…</div>);`
 * 主题变量挂在 <html> 上，渲染到 body 下样式不受影响。
 */
export const renderInBody = (node) => (
    typeof document === 'undefined' || !document.body ? node : createPortal(node, document.body)
);
