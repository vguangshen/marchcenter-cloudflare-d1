import React, { useEffect, useRef } from 'react';

const YuanxiaoSystem = ({ active }) => {
    const canvasRef = useRef(null);

    useEffect(() => {
        if (!active) return;

        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        let width = canvas.width = window.innerWidth;
        let height = canvas.height = window.innerHeight;
        let items = [];

        const random = (min, max) => Math.random() * (max - min) + min;

        // 🥣 汤圆类
        class Tangyuan {
            constructor() {
                this.init(true);
            }

            init(isStart = false) {
                this.x = random(0, width);
                this.y = isStart ? random(0, height) : height + 50;
                this.size = random(8, 15); // 大小
                this.speedY = random(0.5, 1.5); // 上浮速度
                this.speedX = random(-0.3, 0.3); // 左右漂浮
                this.opacity = random(0.6, 0.9);
            }

            update() {
                this.y -= this.speedY;
                this.x += this.speedX;
                if (this.y < -50) this.init();
            }

            draw() {
                ctx.save();
                ctx.globalAlpha = this.opacity;
                ctx.shadowBlur = 10;
                ctx.shadowColor = 'white';
                ctx.fillStyle = '#fff'; // 白糯米
                ctx.beginPath();
                ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
                ctx.fill();

                // 芝麻馅阴影（显得立体）
                ctx.shadowBlur = 0;
                ctx.fillStyle = 'rgba(0,0,0,0.05)';
                ctx.beginPath();
                ctx.arc(this.x - 2, this.y - 2, this.size * 0.8, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();
            }
        }

        // 🏷️ 灯谜纸条类
        class RiddleTag {
            constructor() {
                this.init(true);
            }

            init(isStart = false) {
                this.x = random(0, width);
                this.y = isStart ? random(0, height) : height + 50;
                this.w = random(12, 18);
                this.h = random(30, 50);
                this.speedY = random(0.8, 2);
                this.angle = random(-0.2, 0.2);
                this.swingSpeed = random(0.01, 0.03);
                this.color = Math.random() > 0.5 ? '#FF9A9E' : '#FECFEF'; // 粉红/浅紫
            }

            update() {
                this.y -= this.speedY;
                this.angle += Math.sin(this.y * 0.02) * 0.01; // 摇摆
                if (this.y < -60) this.init();
            }

            draw() {
                ctx.save();
                ctx.translate(this.x, this.y);
                ctx.rotate(this.angle);

                // 纸条主体
                ctx.fillStyle = this.color;
                ctx.fillRect(-this.w/2, -this.h/2, this.w, this.h);

                // 模拟上面的字（线条）
                ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
                ctx.fillRect(-this.w/2 + 3, -this.h/2 + 5, this.w - 6, 2);
                ctx.fillRect(-this.w/2 + 3, -this.h/2 + 10, this.w - 6, 2);
                ctx.fillRect(-this.w/2 + 3, -this.h/2 + 15, this.w - 6, 2);

                // 挂绳
                ctx.strokeStyle = 'rgba(255,255,255,0.5)';
                ctx.beginPath();
                ctx.moveTo(0, -this.h/2);
                ctx.lineTo(0, -this.h/2 - 10);
                ctx.stroke();

                ctx.restore();
            }
        }

        const init = () => {
            items = [];
            // 汤圆数量
            const tCount = Math.floor(width / 80);
            for (let i = 0; i < tCount; i++) items.push(new Tangyuan());

            // 灯谜数量
            const rCount = Math.floor(width / 100);
            for (let i = 0; i < rCount; i++) items.push(new RiddleTag());
        };

        init();

        let frameId;
        const animate = () => {
            ctx.clearRect(0, 0, width, height);
            items.forEach(item => {
                item.update();
                item.draw();
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

export default YuanxiaoSystem;