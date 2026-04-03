// ===== 公共 JS =====

// 移动端菜单
function toggleMobileMenu() {
    const menu = document.querySelector('.nav-links');
    menu.classList.toggle('open');
}

// 侧边栏移动端切换
function toggleSidebar() {
    document.querySelector('.sidebar')?.classList.toggle('open');
}

// 平滑滚动
document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function(e) {
            const target = document.querySelector(this.getAttribute('href'));
            if (target) {
                e.preventDefault();
                target.scrollIntoView({ behavior: 'smooth', block: 'start' });
                // 关闭移动菜单
                document.querySelector('.nav-links')?.classList.remove('open');
                document.querySelector('.sidebar')?.classList.remove('open');
            }
        });
    });
});

// 导航栏滚动效果
window.addEventListener('scroll', () => {
    const nav = document.querySelector('.site-nav');
    if (nav && window.scrollY > 20) {
        nav.style.boxShadow = '0 4px 30px rgba(0,0,0,0.3)';
    } else if (nav) {
        nav.style.boxShadow = 'none';
    }
});
