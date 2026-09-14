import React, { useEffect, useRef } from 'react';

const BatSystem = ({ active }) => {
    const canvasRef = useRef(null);

    useEffect(() => {
        if (!active) return;

        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        let width = canvas.width = window.innerWidth;
        let height = canvas.height = window.innerHeight;
        let bats = [];

        const random = (min, max) => Math.random() * (max - min) + min;

        class Bat {
            constructor() {
                this.x = random(0, width);
                this.y = random(0, height);
                this.size = random(15, 30);
                // 蝙蝠稍微往右飞或往左飞
                this.speedX = random(-2, 2) || 1;
                this.speedY = random(-1, 1);
                this.wingAngle = 0;
                this.wingSpeed = random(0.1, 0.3);
                this.color = `rgba(30, 30, 30, ${random(0.4, 0.8)})`; // 半透明深灰色
            }

            update() {
                this.x += this.speedX;
                this.y += this.speedY + Math.sin(this.x * 0.01) * 0.5; // 稍微波浪形飞行
                this.wingAngle += this.wingSpeed;

                // 边界检查：飞出屏幕后从另一侧回来
                if (this.x > width + 50) this.x = -50;
                if (this.x < -50) this.x = width + 50;
                if (this.y > height + 50) this.y = -50;
                if (this.y < -50) this.y = height + 50;
            }

            draw() {
                ctx.fillStyle = this.color;
                ctx.beginPath();

                // 简单的蝙蝠形状绘制
                // 身体
                ctx.arc(this.x, this.y, this.size / 5, 0, Math.PI * 2);

                // 翅膀 (根据 wingAngle 改变 y 坐标模拟扇动)
                const wingY = Math.sin(this.wingAngle) * (this.size / 2);

                // 左翼
                ctx.moveTo(this.x - this.size / 5, this.y);
                ctx.quadraticCurveTo(this.x - this.size / 2, this.y - wingY - this.size/2, this.x - this.size, this.y + wingY);
                ctx.quadraticCurveTo(this.x - this.size / 2, this.y + this.size / 3, this.x - this.size / 5, this.y);

                // 右翼
                ctx.moveTo(this.x + this.size / 5, this.y);
                ctx.quadraticCurveTo(this.x + this.size / 2, this.y - wingY - this.size/2, this.x + this.size, this.y + wingY);
                ctx.quadraticCurveTo(this.x + this.size / 2, this.y + this.size / 3, this.x + this.size / 5, this.y);

                ctx.fill();
            }
        }

        // 初始化蝙蝠群
        const initBats = () => {
            bats = [];
            const batCount = Math.floor(width / 100); // 根据屏幕宽度决定数量
            for (let i = 0; i < batCount; i++) {
                bats.push(new Bat());
            }
        };

        initBats();

        let frameId;
        const animate = () => {
            ctx.clearRect(0, 0, width, height);
            bats.forEach(bat => {
                bat.update();
                bat.draw();
            });
            frameId = requestAnimationFrame(animate);
        };

        const handleResize = () => {
            width = canvas.width = window.innerWidth;
            height = canvas.height = window.innerHeight;
            initBats();
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
            // 放在背景层，不遮挡内容
            className="fixed inset-0 z-[1] pointer-events-none"
        />
    );
};

export default BatSystem;