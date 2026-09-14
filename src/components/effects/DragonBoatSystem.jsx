import React, { useEffect, useRef } from 'react';

const DragonBoatSystem = ({ active }) => {
    const canvasRef = useRef(null);

    useEffect(() => {
        if (!active) return;

        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        let width = canvas.width = window.innerWidth;
        let height = canvas.height = window.innerHeight;
        let leaves = [];

        const random = (min, max) => Math.random() * (max - min) + min;

        class Leaf {
            constructor() {
                this.init(true);
            }

            init(isStart = false) {
                this.x = random(0, width);
                this.y = isStart ? random(0, height) : -50;
                this.size = random(15, 30); // 叶子长度
                this.width = this.size / 3; // 叶子宽度
                this.angle = random(0, Math.PI * 2); // 初始角度

                this.spinSpeed = random(-0.02, 0.02);
                this.speedY = random(0.4, 1.3);
                this.speedX = random(-0.5, 0.5);

                // 不同深浅的绿色
                const green = Math.floor(random(100, 180));
                this.color = `rgba(30, ${green}, 60, ${random(0.6, 0.9)})`;
            }

            update() {
                this.y += this.speedY;
                this.x += this.speedX + Math.sin(this.y * 0.01);
                this.angle += this.spinSpeed;

                if (this.y > height + 50) {
                    this.init();
                }
            }

            draw() {
                ctx.save();
                ctx.translate(this.x, this.y);
                ctx.rotate(this.angle);

                ctx.fillStyle = this.color;
                ctx.beginPath();
                // 绘制两头尖中间宽的叶子形状
                ctx.moveTo(0, -this.size / 2);
                ctx.quadraticCurveTo(this.width, 0, 0, this.size / 2);
                ctx.quadraticCurveTo(-this.width, 0, 0, -this.size / 2);
                ctx.fill();

                // 叶脉
                ctx.strokeStyle = 'rgba(255,255,255,0.2)';
                ctx.beginPath();
                ctx.moveTo(0, -this.size / 2);
                ctx.lineTo(0, this.size / 2);
                ctx.stroke();

                ctx.restore();
            }
        }

        const init = () => {
            leaves = [];
            // Keep the leaves sparse enough that cards remain readable.
            const count = Math.floor(width / 60);
            for (let i = 0; i < count; i++) {
                leaves.push(new Leaf());
            }
        };

        init();

        let frameId;
        const animate = () => {
            ctx.clearRect(0, 0, width, height);
            leaves.forEach(leaf => {
                leaf.update();
                leaf.draw();
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

export default DragonBoatSystem;
