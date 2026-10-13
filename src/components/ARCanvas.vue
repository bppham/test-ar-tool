<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

// Cung cấp THREE vào window để 8th Wall Threejs pipeline module sử dụng
if (typeof window !== 'undefined') {
    window.THREE = THREE
}

const props = defineProps<{
    locationData: any
}>()

defineEmits<{
    (e: 'back'): void
}>()

const arCanvas = ref<HTMLCanvasElement | null>(null)
const isCameraReady = ref(false)
const isTargetFound = ref(false)
const errorMessage = ref('')

// Biến quản lý âm thanh
const audioObj = ref<HTMLAudioElement | null>(null)
const isPlaying = ref(false)

// Debug log (ẩn mặc định, bấm nút mới hiện)
const showDebug = ref(false)
const debugLogs = ref<string[]>([])
const addLog = (msg: string) => {
    console.log(`[AR] ${msg}`)
    debugLogs.value.push(`${new Date().toLocaleTimeString()} ${msg}`)
    if (debugLogs.value.length > 30) debugLogs.value.shift()
}

// Hàm Bật/Tắt âm thanh thủ công
const toggleAudio = () => {
    if (!audioObj.value) return
    if (isPlaying.value) {
        audioObj.value.pause()
        isPlaying.value = false
    } else {
        audioObj.value.play()
        isPlaying.value = true
    }
}

const imageTrackingPipeline = () => {
    let modelMesh: THREE.Group | null = null

    return {
        name: 'custom-image-tracking',
        onStart: () => {
            addLog('✅ Pipeline onStart — Camera OK')
            isCameraReady.value = true

            try {
                const { scene } = window.XR8.Threejs.xrScene()

                scene.add(new THREE.AmbientLight(0xffffff, 1))
                const dirLight = new THREE.DirectionalLight(0xffffff, 2)
                dirLight.position.set(0, 10, 5)
                scene.add(dirLight)

                // Tải Model 3D
                if (props.locationData.modelUrl) {
                    addLog(`📦 Tải model: ${props.locationData.modelUrl}`)
                    const loader = new GLTFLoader()
                    loader.load(
                        props.locationData.modelUrl,
                        (gltf) => {
                            modelMesh = gltf.scene
                            modelMesh.visible = false
                            const s = props.locationData.modelConfig?.scale || 1.0
                            modelMesh.scale.set(s, s, s)
                            scene.add(modelMesh)
                            addLog('✅ Model 3D OK')
                        },
                        undefined,
                        (err) => addLog(`❌ Lỗi model: ${err}`)
                    )
                }

                // Tải Audio
                if (props.locationData.audioUrl) {
                    audioObj.value = new Audio(props.locationData.audioUrl)
                    audioObj.value.loop = true
                    addLog('🔊 Audio OK')
                }
            } catch (err: any) {
                addLog(`❌ onStart error: ${err?.message || err}`)
            }
        },

        onException: (err: any) => {
            addLog(`❌ Pipeline error: ${err?.message || err}`)
            errorMessage.value = `Pipeline lỗi: ${err?.message || err}`
        },

        listeners: [
            {
                event: 'reality.imagefound',
                process: (event: any) => {
                    addLog(`🎯 imagefound: "${event.detail.name}"`)
                    if (event.detail.name === props.locationData.targetId) {
                        isTargetFound.value = true
                        if (modelMesh) {
                            modelMesh.visible = true
                            modelMesh.position.copy(event.detail.position)
                            modelMesh.quaternion.copy(event.detail.rotation)
                        }
                        if (audioObj.value && !isPlaying.value) {
                            audioObj.value.play().then(() => {
                                isPlaying.value = true
                            }).catch(() => {
                                addLog('⚠️ Auto-play bị chặn')
                            })
                        }
                    }
                }
            },
            {
                event: 'reality.imageupdated',
                process: (event: any) => {
                    if (modelMesh && modelMesh.visible) {
                        modelMesh.position.copy(event.detail.position)
                        modelMesh.quaternion.copy(event.detail.rotation)
                    }
                }
            },
            {
                event: 'reality.imagelost',
                process: () => {
                    addLog('👋 imagelost')
                }
            }
        ]
    }
}

const startAR = () => {
    addLog('🚀 startAR()')
    errorMessage.value = ''

    if (!arCanvas.value) {
        errorMessage.value = 'Canvas chưa sẵn sàng'
        return
    }
    if (!window.XR8) {
        errorMessage.value = 'Engine 8th Wall không tải được. Kiểm tra mạng.'
        return
    }

    try {
        window.THREE = THREE
        window.XR8.clearCameraPipelineModules()

        window.XR8.addCameraPipelineModules([
            window.XR8.GlTextureRenderer.pipelineModule(),
            window.XR8.Threejs.pipelineModule(),
            window.XR8.XrController.pipelineModule(),
            imageTrackingPipeline()
        ])

        if (window.XR8.XrController.configure) {
            window.XR8.XrController.configure({ disableWorldTracking: false })
        }

        window.XR8.run({
            canvas: arCanvas.value,
            allowedDevices: window.XR8.XrConfig?.device?.().ANY,
        })
        addLog('✅ XR8.run() OK')
    } catch (err: any) {
        addLog(`❌ ${err?.message || err}`)
        errorMessage.value = `Lỗi: ${err?.message || err}`
    }
}

onMounted(() => {
    addLog('📌 onMounted')
    if (window.XR8) {
        startAR()
    } else {
        addLog('⏳ Chờ xrloaded...')
        window.addEventListener('xrloaded', () => {
            addLog('✅ xrloaded fired')
            startAR()
        }, { once: true })
    }
})

onBeforeUnmount(() => {
    if (audioObj.value) {
        audioObj.value.pause()
        audioObj.value = null
    }
    if (window.XR8) {
        try {
            window.XR8.stop()
            window.XR8.clearCameraPipelineModules()
        } catch (_e) { /* ignore */ }
    }
})
</script>

<template>
    <div class="relative w-full h-screen overflow-hidden bg-black">
        <!-- Camera Canvas: PHẢI nằm dưới cùng, chiếm toàn bộ màn hình -->
        <canvas ref="arCanvas" class="absolute inset-0 w-full h-full block" style="z-index: 0;"></canvas>

        <!-- ===== LAYER 1: Loading overlay (z-10) ===== -->
        <div v-if="!isCameraReady && !errorMessage"
            class="absolute inset-0 z-10 flex flex-col items-center justify-center bg-gray-900 text-white">
            <div class="w-14 h-14 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-5"></div>
            <p class="text-xl font-bold">Đang khởi động Camera...</p>
            <p class="text-sm text-gray-400 mt-2">Hãy chấp nhận quyền Camera nếu được hỏi</p>
        </div>

        <!-- ===== LAYER 1: Error overlay (z-10) ===== -->
        <div v-if="errorMessage"
            class="absolute inset-0 z-10 flex flex-col items-center justify-center bg-gray-900 text-white px-8">
            <p class="text-5xl mb-4">⚠️</p>
            <p class="text-lg font-bold text-red-400 mb-2">Lỗi khởi động AR</p>
            <p class="text-sm text-gray-300 text-center mb-6">{{ errorMessage }}</p>
            <button @click="startAR()"
                class="px-6 py-3 bg-blue-600 text-white font-bold rounded-xl active:bg-blue-700">
                🔄 Thử lại
            </button>
        </div>

        <!-- ===== LAYER 2: Scanning guide (z-20) — CHỈ hiện khi camera đã bật ===== -->
        <div v-if="isCameraReady && !isTargetFound"
            class="absolute inset-0 z-20 flex flex-col items-center justify-center pointer-events-none">
            <!-- Khung viền quét — trong suốt để nhìn thấy camera -->
            <div class="w-56 h-56 border-[3px] border-dashed border-white/60 rounded-2xl"></div>
            <p class="mt-5 text-base font-semibold text-white text-center drop-shadow-lg
                       bg-black/50 px-4 py-2 rounded-full">
                📷 Đưa camera vào hình con dấu
            </p>
        </div>

        <!-- ===== LAYER 3: Info popup khi quét trúng (z-30) ===== -->
        <div v-if="isTargetFound"
            class="absolute bottom-6 left-4 right-4 z-30
                   bg-white/95 backdrop-blur-md p-5 rounded-3xl shadow-2xl">
            <h2 class="text-xl font-extrabold text-gray-800 mb-1">{{ locationData.name }}</h2>
            <p class="text-gray-500 text-sm mb-4 leading-relaxed line-clamp-3">
                {{ locationData.description }}
            </p>
            <div class="flex gap-3">
                <a :href="locationData.mapsUrl" target="_blank"
                    class="flex-1 bg-blue-600 text-white text-center py-3 rounded-xl font-bold text-base active:bg-blue-700 shadow">
                    📍 Chỉ đường
                </a>
                <button @click="toggleAudio"
                    class="w-14 h-14 flex items-center justify-center bg-gray-100 text-gray-700 rounded-xl active:bg-gray-200 text-2xl shadow">
                    {{ isPlaying ? '🔊' : '🔇' }}
                </button>
            </div>
        </div>

        <!-- ===== LAYER 4: Nút Back + Nút Debug (z-40, luôn hiện) ===== -->
        <button @click="$emit('back')"
            class="absolute top-5 left-5 z-40
                   w-10 h-10 bg-black/50 backdrop-blur text-white rounded-full
                   flex items-center justify-center text-lg shadow-lg active:scale-90 transition">
            ✕
        </button>

        <!-- Nút toggle debug log -->
        <button @click="showDebug = !showDebug"
            class="absolute top-5 right-5 z-40
                   px-3 py-2 bg-black/50 backdrop-blur text-white/70 rounded-full
                   text-[10px] font-mono shadow active:scale-90 transition">
            {{ showDebug ? '🔽 LOG' : '🐛 LOG' }}
        </button>

        <!-- ===== Debug Log Panel (z-50, ẩn mặc định) ===== -->
        <div v-if="showDebug"
            class="absolute top-16 right-2 left-2 z-50
                   max-h-52 overflow-y-auto bg-black/85 backdrop-blur
                   text-green-400 text-[10px] font-mono p-3 rounded-xl leading-snug">
            <div v-for="(log, i) in debugLogs" :key="i">{{ log }}</div>
            <div v-if="!debugLogs.length" class="text-gray-500">Chờ log...</div>
        </div>
    </div>
</template>