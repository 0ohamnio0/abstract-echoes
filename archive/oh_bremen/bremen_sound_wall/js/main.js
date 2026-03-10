import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { AudioAnalyzer } from './audio.js';
import { TextureGenerator } from './brushes.js';

class App {
    constructor() {
        this.container = document.getElementById('gl');
        this.overlay = document.getElementById('overlay');
        this.startBtn = document.getElementById('start-btn');
        
        this.width = window.innerWidth;
        this.height = window.innerHeight;

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0xed7327); // Orange Background

        this.camera = new THREE.PerspectiveCamera(90, this.width / this.height, 0.1, 1000);
        this.camera.position.set(0, 0, 20);

        this.renderer = new THREE.WebGLRenderer({
            canvas: this.container,
            antialias: true
        });
        this.renderer.setSize(this.width, this.height);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;

        // Lights (from Bolt project)
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
        this.scene.add(ambientLight);
        const pointLight = new THREE.PointLight(0xffffff, 0.5);
        pointLight.position.set(10, 10, 10);
        this.scene.add(pointLight);

        this.clock = new THREE.Clock();
        this.audioAnalyzer = new AudioAnalyzer();

        // Particle System
        this.particles = [];
        this.maxParticles = 2000;
        
        // Texture
        const canvas = TextureGenerator.createBrushTexture();
        this.texture = new THREE.CanvasTexture(canvas);
        
        // Sprite Pooling
        this.spritePool = [];
        this.activeSprites = []; // { sprite, velocity, age, scale, maxAge }

        this.initPool();
        this.addEvents();
        
        this.animate = this.animate.bind(this);
    }

    initPool() {
        const material = new THREE.SpriteMaterial({
            map: this.texture,
            transparent: true,
            opacity: 1.0,
            color: 0x000000,
            blending: THREE.NormalBlending,
            depthWrite: false,
            depthTest: false // Optional: sometimes better for overlapping sprites
        });

        for(let i=0; i<this.maxParticles; i++) {
            const sprite = new THREE.Sprite(material.clone()); // Clone material for individual opacity control if needed
            // Actually, cloning material 2000 times is okay, but sharing matches reference better if opacity is uniform.
            // But reference has decaying opacity per particle. So unique material or vertex color needed.
            // Using unique material for now (easiest port), or better: onBeforeRender or ShaderMaterial.
            // Bolt project created NEW material every frame. That's bad.
            // Optimally: use THREE.Points.
            // But let's stick to Sprite + unique material for exact visual match of "Sprite" behavior unless perf kills us.
            // 2000 draw calls is heavy. 
            // Better: Re-use materials in a pool too? 
            // Actually, let's try THREE.Points for performance.
            // But Bolt used Sprites. Let's start with Sprites but hide them when inactive.
            
            sprite.visible = false;
            this.scene.add(sprite);
            this.spritePool.push({
                mesh: sprite,
                material: sprite.material,
                velocity: new THREE.Vector3(),
                age: 0,
                maxAge: 200,
                baseScale: 1
            });
        }
    }

    addEvents() {
        window.addEventListener('resize', this.onResize.bind(this));
        
        this.startBtn.addEventListener('click', async () => {
            this.overlay.classList.add('hidden');
            await this.audioAnalyzer.init();
            this.animate();
        });
    }

    onResize() {
        this.width = window.innerWidth;
        this.height = window.innerHeight;
        this.camera.aspect = this.width / this.height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(this.width, this.height);
    }

    spawnParticles(audioData) {
        if (audioData.amplitude <= 0.02) return;

        // Bolt Logic:
        // x = (amp - 0.5) * 20
        // y = freq * 10
        // z = (comp - 0.5) * 15
        
        const x = (audioData.amplitude - 0.5) * 20;
        const y = (audioData.frequency - 0.5) * 10; // Centered Y for better view
        const z = (audioData.complexity - 0.5) * 15;

        const particleCount = Math.floor(5 + audioData.amplitude * 20);

        for (let i = 0; i < particleCount; i++) {
            // Find available sprite
            const particle = this.spritePool.find(p => !p.mesh.visible);
            if (!particle) {
                // Steal oldest? Or just skip.
                // For now, simpler to skip or expand pool.
                // Let's just create a recycling logic: shift from active list?
                // For this implementation, simple finding invisible is O(N). 
                // Better: keep index.
                continue;
            }

            const spreadRadius = (i / particleCount) * 1.5;
            const angle = Math.random() * Math.PI * 2;
            const offsetX = Math.cos(angle) * spreadRadius * Math.random();
            const offsetY = Math.sin(angle) * spreadRadius * Math.random();
            const offsetZ = (Math.random() - 0.5) * spreadRadius;

            particle.mesh.position.set(x + offsetX, y + offsetY, z + offsetZ);
            
            particle.velocity.set(
                (Math.random() - 0.5) * 0.05,
                (Math.random() - 0.5) * 0.05,
                (Math.random() - 0.5) * 0.05
            );

            particle.age = 0;
            const scaleVariation = 0.5 + Math.random() * 1.8;
            particle.baseScale = audioData.amplitude * 4 * scaleVariation;
            particle.mesh.scale.set(particle.baseScale, particle.baseScale, 1);
            
            particle.mesh.visible = true;
            particle.material.opacity = 0.6; // Start opacity
        }
    }

    updateParticles() {
        for (const particle of this.spritePool) {
            if (!particle.mesh.visible) continue;

            particle.age += 1;
            particle.mesh.position.add(particle.velocity);
            particle.velocity.multiplyScalar(0.98); // Drag

            if (particle.age >= particle.maxAge) {
                particle.mesh.visible = false;
            } else {
                // Opacity Fade
                const opacity = Math.max(0, 1 - particle.age / 200) * 0.6;
                particle.material.opacity = opacity;

                // Scale Up
                const finalScale = particle.baseScale * (1 + particle.age * 0.002);
                particle.mesh.scale.set(finalScale, finalScale, 1);
            }
        }
    }

    animate() {
        requestAnimationFrame(this.animate);

        const audioData = this.audioAnalyzer.getAudioData();
        
        this.spawnParticles(audioData);
        this.updateParticles();

        this.controls.update();
        this.renderer.render(this.scene, this.camera);
    }
}

new App();
