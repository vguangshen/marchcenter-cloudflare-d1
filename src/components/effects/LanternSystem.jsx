import React, { useEffect, useRef } from 'react';

const LanternSystem = ({ active }) => {
    const canvasRef = useRef(null);

    useEffect(() => {
        if (!active) return;

        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        let width = canvas.width = window.innerWidth;
        let height = canvas.height = window.innerHeight;

        let lanterns = [];
        let clouds = [];

        const random = (min, max) => Math.random() * (max - min) + min;

        // --- ☁️ 祥云类 ---
        class Cloud {
            constructor() {
                this.init(true);
            }

            init(isStart = false) {
                // 初始位置
                this.x = isStart ? random(0, width) : (Math.random() < 0.5 ? -200 : width + 200);
                this.y = random(height * 0.1, height * 0.7);

                this.speedX = (Math.random() < 0.5 ? 1 : -1) * random(0.2, 0.5);

                this.size = random(80, 150);
                this.stretch = random(2, 3); // 拉得更长，更有祥云的感觉

                this.opacity = 0;
                this.targetOpacity = random(0.3, 0.5);
                this.life = 0;
                this.fadeSpeed = random(0.003, 0.008);
                this.state = 'in';
                this.stayTime = random(800, 2000);
            }

            update() {
                this.x += this.speedX;

                if (this.state === 'in') {
                    this.opacity += this.fadeSpeed;
                    if (this.opacity >= this.targetOpacity) this.state = 'stay';
                } else if (this.state === 'stay') {
                    this.life++;
                    if (this.life > this.stayTime) this.state = 'out';
                } else if (this.state === 'out') {
                    this.opacity -= this.fadeSpeed;
                    if (this.opacity <= 0) {
                        this.init();
                    }
                }
            }

            draw() {
                if (this.opacity <= 0) return;

                ctx.save();
                ctx.globalAlpha = this.opacity;

                ctx.filter = 'blur(20px)';
                ctx.fillStyle = '#E0F2FE'; // 玉白色

                ctx.beginPath();
                // 主体
                ctx.ellipse(this.x, this.y, this.size * this.stretch, this.size, 0, 0, Math.PI * 2);
                // 附体云块，增加随机感
                ctx.ellipse(this.x - this.size * 0.8, this.y + this.size * 0.4, this.size * 0.9, this.size * 0.7, 0, 0, Math.PI * 2);
                ctx.ellipse(this.x + this.size * 1.0, this.y - this.size * 0.3, this.size * 0.8, this.size * 0.6, 0, 0, Math.PI * 2);

                ctx.fill();
                ctx.restore();
            }
        }

        // --- 🏮 孔明灯类 ---
        class Lantern {
            constructor() {
                this.x = random(0, width);
                this.y = height + random(0, 200);
                this.width = random(12, 20);
                this.height = this.width * 1.4;
                this.speedY = random(0.3, 0.8);
                this.speedX = random(-0.2, 0.2);
                this.color = `hsla(${random(30, 50)}, 100%, 60%, 0.8)`;
                this.glow = random(10, 20);
                this.flickerSpeed = random(0.02, 0.05);
                this.flickerState = random(0, Math.PI);
            }

            update() {
                this.y -= this.speedY;
                this.x += this.speedX + Math.sin(this.y * 0.01) * 0.1;
                this.flickerState += this.flickerSpeed;

                if (this.y < -50) {
                    this.y = height + 50;
                    this.x = random(0, width);
                }
            }

            draw() {
                const flicker = 0.8 + Math.sin(this.flickerState) * 0.2;

                ctx.save();
                ctx.globalAlpha = flicker;

                ctx.shadowBlur = this.glow;
                ctx.shadowColor = 'orange';

                ctx.fillStyle = this.color;
                ctx.beginPath();
                ctx.moveTo(this.x, this.y);
                ctx.lineTo(this.x + this.width, this.y);
                ctx.lineTo(this.x + this.width * 0.85, this.y + this.height);
                ctx.lineTo(this.x + this.width * 0.15, this.y + this.height);
                ctx.closePath();
                ctx.fill();

                ctx.fillStyle = '#fff';
                ctx.shadowBlur = 5;
                ctx.beginPath();
                ctx.arc(this.x + this.width/2, this.y + this.height * 0.7, this.width * 0.2, 0, Math.PI * 2);
                ctx.fill();

                ctx.restore();
            }
        }

        const init = () => {
            lanterns = [];
            clouds = [];

            const lanternCount = Math.floor(width / 60);
            for (let i = 0; i < lanternCount; i++) {
                lanterns.push(new Lantern());
            }

            const cloudCount = Math.max(5, Math.floor(width / 250));
            for (let i = 0; i < cloudCount; i++) {
                clouds.push(new Cloud());
            }
        };

        init();

        let frameId;
        const animate = () => {
            ctx.clearRect(0, 0, width, height);

            // Draw a few sparse stars behind the lanterns.
            ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
            for(let i=0; i<3; i++) {
               if(Math.random() > 0.9) ctx.fillRect(random(0, width), random(0, height), 2, 2);
            }

            // 先画云 (背景)
            clouds.forEach(c => {
                c.update();
                c.draw();
            });

            // 再画灯 (前景)
            lanterns.forEach(l => {
                l.update();
                l.draw();
            });

            frameId = requestAnimationFrame(animate);
        };

        const handleResize = () => {
            width = canvas.width = window.innerWidth;
            height = canvas.height = window.innerHeight;
            init();
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

export default LanternSystem;
