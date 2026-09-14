import React, { useEffect, useRef } from 'react';

const SnowSystem = ({ active }) => {
    const canvasRef = useRef(null);
    const requestRef = useRef(null);
    const obstaclesRef = useRef([]); // 存储卡片位置

    useEffect(() => {
        if (!active) return;

        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        let width = window.innerWidth;
        let height = window.innerHeight;

        canvas.width = width;
        canvas.height = height;

        // --- 物理参数配置 ---
        const snowflakeCount = 100;
        const wind = 0; // 风力 (稍微随机)

        // --- 雪花粒子类 ---
        class Snowflake {
            constructor() {
                this.reset(true);
            }

            reset(initial = false) {
                this.x = Math.random() * width;
                this.y = initial ? Math.random() * height : -10;
                this.size = Math.random() * 3 + 1; // 大小 1-4px
                this.speedY = Math.random() * 1 + 0.5; // 下落速度
                this.speedX = Math.random() * 1 - 0.5; // 左右飘动
                this.landed = false; // 是否已着陆
                this.landedLife = 200 + Math.random() * 300; // 着陆后的寿命 (帧数)
                this.meltRate = 0.02; // 融化速度
                this.opacity = Math.random() * 0.5 + 0.5;
            }

            update(obstacles) {
                // 如果已经着陆
                if (this.landed) {
                    this.landedLife--;
                    // 寿命耗尽或者变小了 -> 融化/掉落
                    if (this.landedLife <= 0) {
                        this.size -= this.meltRate;
                        // 如果融化完了，重置
                        if (this.size <= 0) this.reset();
                        // 偶尔掉落 (模拟滑落)
                        if (Math.random() > 0.98) {
                            this.landed = false;
                        }
                    }
                    return;
                }

                // 正常下落
                this.x += this.speedX + wind;
                this.y += this.speedY;

                // 左右轻微摆动
                this.speedX += (Math.random() - 0.5) * 0.05;

                // --- 碰撞检测 (核心物理) ---
                // 检查是否撞到了任何一个卡片的顶部
                for (let rect of obstacles) {
                    // 简单的 AABB 碰撞检测
                    // 只有当雪花落在卡片顶部边缘 (Top ~ Top+5px) 范围内时才算停住
                    if (
                        this.y >= rect.top - 2 &&
                        this.y <= rect.top + 5 &&
                        this.x >= rect.left &&
                        this.x <= rect.right
                    ) {
                        this.landed = true;
                        this.y = rect.top + Math.random() * 2; // 稍微随机一点堆积感
                        // 增加一点摩擦力，着陆后不再左右移动
                        break;
                    }
                }

                // 到底重置
                if (this.y > height) {
                    this.reset();
                }
                // 出界处理 (左右)
                if (this.x > width) this.x = 0;
                if (this.x < 0) this.x = width;
            }

            draw(ctx) {
                ctx.fillStyle = `rgba(255, 255, 255, ${this.opacity})`;
                ctx.beginPath();
                ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        // 初始化雪花
        const snowflakes = Array.from({ length: snowflakeCount }, () => new Snowflake());

        // 更新障碍物 (卡片) 位置
        // 为了性能，不每一帧都获取 DOM，每隔 30 帧更新一次即可，或者滚动时更新
        const updateObstacles = () => {
            const cards = document.querySelectorAll('.contest-card');
            obstaclesRef.current = Array.from(cards).map(card => {
                const rect = card.getBoundingClientRect();
                return {
                    top: rect.top,
                    left: rect.left,
                    right: rect.right,
                    width: rect.width
                };
            });
        };

        // 动画循环
        let frameCount = 0;
        let obstaclesDirty = true;
        const markObstaclesDirty = () => { obstaclesDirty = true; };
        const animate = () => {
            ctx.clearRect(0, 0, width, height);

            if (obstaclesDirty || frameCount % 120 === 0) {
                updateObstacles();
                obstaclesDirty = false;
            }
            frameCount++;

            const obstacles = obstaclesRef.current;

            snowflakes.forEach(flake => {
                flake.update(obstacles);
                flake.draw(ctx);
            });

            requestRef.current = requestAnimationFrame(animate);
        };

        animate();

        // 窗口大小改变处理
        const handleResize = () => {
            width = window.innerWidth;
            height = window.innerHeight;
            canvas.width = width;
            canvas.height = height;
        };
        window.addEventListener('resize', handleResize);
        window.addEventListener('scroll', markObstaclesDirty, { passive: true });

        return () => {
            cancelAnimationFrame(requestRef.current);
            window.removeEventListener('resize', handleResize);
            window.removeEventListener('scroll', markObstaclesDirty);
        };
    }, [active]);

    if (!active) return null;

    return (
        <canvas
            ref={canvasRef}
            className="fixed inset-0 pointer-events-none z-50" // z-50 确保在最上层，pointer-events-none 确保不阻挡点击
            style={{ filter: 'drop-shadow(0 0 2px rgba(255,255,255,0.5))' }} // 给雪花加一点光晕
        />
    );
};

export default SnowSystem;
