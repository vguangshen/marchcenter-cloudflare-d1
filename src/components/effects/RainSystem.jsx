import React, { useEffect, useRef } from 'react';

const RainSystem = ({ active }) => {
    const canvasRef = useRef(null);

    useEffect(() => {
        if (!active) return;

        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        let width = canvas.width = window.innerWidth;
        let height = canvas.height = window.innerHeight;
        let drops = [];

        const random = (min, max) => Math.random() * (max - min) + min;
        const map = (val, min1, max1, min2, max2) => (val - min1) / (max1 - min1) * (max2 - min2) + min2;

        class Drop {
            constructor() {
                this.init(true);
            }

            init(isStart = false) {
                this.x = random(0, width);
                this.y = isStart ? random(0, height) : random(-50, -10);
                this.z = random(0, 20); // 深度：0=远，20=近

                this.len = map(this.z, 0, 20, 10, 25);
                this.yspeed = map(this.z, 0, 20, 5, 16);

                // 颜色：半透明深灰/青灰
                const opacity = map(this.z, 0, 20, 0.1, 0.4);
                this.color = `rgba(71, 85, 105, ${opacity})`;
            }

            update() {
                this.y += this.yspeed;
                // 模拟微风吹拂的轻微漂移
                this.x += 0.2;

                if (this.y > height) {
                    this.init();
                }
            }

            draw() {
                ctx.beginPath();
                ctx.lineWidth = map(this.z, 0, 20, 1, 2);
                ctx.strokeStyle = this.color;
                ctx.moveTo(this.x, this.y);
                ctx.lineTo(this.x + 0.2, this.y + this.len); // 稍微倾斜
                ctx.stroke();
            }
        }

        const init = () => {
            drops = [];
            // 密度保持较高，因为速度慢，需要足够数量填满画面
            const count = Math.min(220, Math.floor(width / 6));
            for (let i = 0; i < count; i++) {
                drops.push(new Drop());
            }
        };

        init();

        let frameId;
        const animate = () => {
            // 清除画布
            ctx.clearRect(0, 0, width, height);

            drops.forEach(d => {
                d.update();
                d.draw();
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

export default RainSystem;
