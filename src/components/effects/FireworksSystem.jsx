import React, { useEffect, useRef } from 'react';

const FireworksSystem = ({ active }) => {
    const canvasRef = useRef(null);

    useEffect(() => {
        if (!active) return;

        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        let width = canvas.width = window.innerWidth;
        let height = canvas.height = window.innerHeight;
        let fireworks = [];
        let particles = [];

        // 🎇 优化配色：增加红金比重，提升不透明度，确保白天可见
        const colors = [
            [255, 50, 50],   // 亮红
            [255, 215, 0],   // 纯金
            [255, 100, 0],   // 橙红
            [230, 0, 0],     // 中国红
            [255, 250, 200]  // 闪光白
        ];

        const random = (min, max) => Math.random() * (max - min) + min;

        class Firework {
            constructor() {
                this.x = random(width * 0.1, width * 0.9);
                this.y = height;
                this.targetY = random(height * 0.1, height * 0.5); // 爆炸高度
                this.speed = random(3, 5); // 稍微减慢速度，看起来更优雅
                this.angle = -Math.PI / 2 + random(-0.1, 0.1);
                this.vx = Math.cos(this.angle) * this.speed;
                this.vy = Math.sin(this.angle) * this.speed;
                this.hue = colors[Math.floor(random(0, colors.length))];
                this.trail = [];
                this.alive = true;
            }

            update() {
                this.trail.push([this.x, this.y]);
                if (this.trail.length > 4) this.trail.shift();

                this.x += this.vx;
                this.y += this.vy;
                this.vy += 0.04; // 增加重力感

                if (this.y <= this.targetY || this.vy >= 0) {
                    this.alive = false;
                    this.explode();
                }
            }

            draw() {
                ctx.beginPath();
                if (this.trail.length > 1) {
                    ctx.moveTo(this.trail[0][0], this.trail[0][1]);
                    for (let i = 1; i < this.trail.length; i++) {
                        ctx.lineTo(this.trail[i][0], this.trail[i][1]);
                    }
                } else {
                    ctx.moveTo(this.x, this.y);
                    ctx.lineTo(this.x + this.vx, this.y + this.vy);
                }
                // 使用纯色线条，不再依赖混合模式
                ctx.strokeStyle = `rgb(${this.hue[0]}, ${this.hue[1]}, ${this.hue[2]})`;
                ctx.lineWidth = 3;
                ctx.stroke();
            }

            explode() {
                const particleCount = Math.floor(random(35, 65));
                for (let i = 0; i < particleCount; i++) {
                    particles.push(new Particle(this.x, this.y, this.hue));
                }
            }
        }

        class Particle {
            constructor(x, y, hue) {
                this.x = x;
                this.y = y;
                this.hue = hue;
                this.angle = random(0, Math.PI * 2);
                this.speed = random(1, 6);
                this.friction = 0.96;
                this.gravity = 0.06;
                this.vx = Math.cos(this.angle) * this.speed;
                this.vy = Math.sin(this.angle) * this.speed;
                this.alpha = 1;
                this.decay = random(0.01, 0.02);
                this.trail = [];
            }

            update() {
                this.trail.push([this.x, this.y]);
                if (this.trail.length > 3) this.trail.shift(); // 缩短尾迹

                this.vx *= this.friction;
                this.vy *= this.friction;
                this.vy += this.gravity;
                this.x += this.vx;
                this.y += this.vy;
                this.alpha -= this.decay;
            }

            draw() {
                if (this.alpha <= 0) return;

                // 绘制粒子拖尾
                if (this.trail.length > 1) {
                    ctx.beginPath();
                    ctx.moveTo(this.trail[0][0], this.trail[0][1]);
                    for (let i = 1; i < this.trail.length; i++) {
                        ctx.lineTo(this.trail[i][0], this.trail[i][1]);
                    }
                    ctx.strokeStyle = `rgba(${this.hue[0]}, ${this.hue[1]}, ${this.hue[2]}, ${this.alpha})`;
                    ctx.lineWidth = 2;
                    ctx.stroke();
                }

                // 绘制粒子核心（发光点）
                ctx.beginPath();
                ctx.arc(this.x, this.y, 1.5, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(255, 255, 255, ${this.alpha})`;
                ctx.fill();
            }
        }

        let frameId;
        let lastLaunchTime = 0;

        const animate = (timestamp) => {
            // 清除画布：使用 clearRect 确保背景透明，不遮挡下层元素
            ctx.clearRect(0, 0, width, height);

            // 随机发射逻辑
            if (timestamp - lastLaunchTime > random(1000, 2200) && particles.length < 500) {
                fireworks.push(new Firework());
                lastLaunchTime = timestamp;
                if (Math.random() < 0.2) fireworks.push(new Firework());
            }

            // 更新烟花（升空阶段）
            for (let i = fireworks.length - 1; i >= 0; i--) {
                fireworks[i].update();
                if (fireworks[i].alive) {
                    fireworks[i].draw();
                } else {
                    fireworks.splice(i, 1);
                }
            }

            // 更新粒子（爆炸阶段）
            for (let i = particles.length - 1; i >= 0; i--) {
                particles[i].update();
                if (particles[i].alpha > 0) {
                    particles[i].draw();
                } else {
                    particles.splice(i, 1);
                }
            }

            frameId = requestAnimationFrame(animate);
        };

        const handleResize = () => {
            width = canvas.width = window.innerWidth;
            height = canvas.height = window.innerHeight;
        };

        window.addEventListener('resize', handleResize);
        frameId = requestAnimationFrame(animate);

        return () => {
            cancelAnimationFrame(frameId);
            window.removeEventListener('resize', handleResize);
        };
    }, [active]);

    if (!active) return null;

    return (
        <canvas
            ref={canvasRef}
            className="fixed inset-0 z-[1] pointer-events-none"
        />
    );
};

export default FireworksSystem;
