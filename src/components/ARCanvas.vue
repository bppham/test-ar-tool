<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import {
    Landmark,
    LocateFixed,
    Volume2,
    VolumeX,
    Eye,
    Move,
    RotateCw,
    Plus,
    Minus,
    X,
    Sparkles,
    Camera,
    MapPin,
    Lightbulb,
    Bug,
    RefreshCw,
    AlertTriangle
} from '@lucide/vue'

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
const isModelLoaded = ref(false)
const loadProgress = ref(0)

// Quản lý âm thanh
const audioObj = ref<HTMLAudioElement | null>(null)
const isPlaying = ref(false)

// Debug log (thu nhỏ, ẩn mặc định)
const showDebug = ref(false)
const debugLogs = ref<string[]>([])
const addLog = (msg: string) => {
    console.log(`[AR] ${msg}`)
    debugLogs.value.push(`${new Date().toLocaleTimeString()} ${msg}`)
    if (debugLogs.value.length > 30) debugLogs.value.shift()
}

// Bật/Tắt âm thanh thuyết minh
const toggleAudio = () => {
    if (!audioObj.value) return
    if (isPlaying.value) {
        audioObj.value.pause()
        isPlaying.value = false
    } else {
        audioObj.value.play().then(() => {
            isPlaying.value = true
        }).catch((err) => {
            addLog(`[WARN] Không phát được audio: ${err?.message || err}`)
        })
    }
}

// Quản lý Three.js và Model
let threeScene: THREE.Scene | null = null
let threeCamera: THREE.PerspectiveCamera | null = null
const modelAnchor = new THREE.Group()
let modelMesh: THREE.Group | null = null
let shadowMesh: THREE.Mesh | null = null

// Quản lý UI
const showDetailModal = ref(false)
const isUiHidden = ref(false)
const showHint = ref(true)
const gestureMode = ref<'move' | 'rotate'>('move') // 'move': Kéo di chuyển trên bàn | 'rotate': Xoay quanh trục Y

// Điều khiển kích thước mô hình (Zoom / Scale)
const scaleMultiplier = ref(1.0)
const baseModelScale = ref(1.0)

const applyScale = () => {
    if (modelMesh && baseModelScale.value > 0) {
        const s = baseModelScale.value * scaleMultiplier.value
        modelMesh.scale.set(s, s, s)
        if (shadowMesh) {
            shadowMesh.scale.set(s, s, s)
        }
    }
}

const updateScale = (val: number) => {
    scaleMultiplier.value = Math.max(0.15, Math.min(4.0, val))
    applyScale()
}

const zoomIn = () => {
    updateScale(scaleMultiplier.value + 0.15)
}

const zoomOut = () => {
    updateScale(scaleMultiplier.value - 0.15)
}

const resetScale = () => {
    updateScale(1.0)
}

// Tạo bóng đổ mềm mại tiếp xúc mặt bàn (Soft Ground Contact Shadow)
const createContactShadow = (radius = 0.5) => {
    const canvas = document.createElement('canvas')
    canvas.width = 128
    canvas.height = 128
    const ctx = canvas.getContext('2d')
    if (ctx) {
        const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64)
        gradient.addColorStop(0, 'rgba(0, 0, 0, 0.65)')
        gradient.addColorStop(0.3, 'rgba(0, 0, 0, 0.4)')
        gradient.addColorStop(0.7, 'rgba(0, 0, 0, 0.12)')
        gradient.addColorStop(1, 'rgba(0, 0, 0, 0)')
        ctx.fillStyle = gradient
        ctx.fillRect(0, 0, 128, 128)
    }
    const texture = new THREE.CanvasTexture(canvas)
    const geometry = new THREE.PlaneGeometry(radius * 2, radius * 2)
    const material = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
        opacity: 0.85
    })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.rotation.x = -Math.PI / 2
    mesh.position.y = 0.001
    return mesh
}

// Hàm đặt model ngay trước tầm mắt (Thẳng thắn 100%, đúng tầm mặt bàn)
const skipAndShowModel = () => {
    if (!isModelLoaded.value || !modelMesh) {
        addLog('[WARN] Model chưa tải xong, vui lòng chờ...')
        return
    }

    try {
        if (threeCamera) {
            // 1. Lấy hướng nhìn ngang của camera
            const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(threeCamera.quaternion)
            const horiz = new THREE.Vector3(forward.x, 0, forward.z).normalize()
            if (horiz.lengthSq() < 0.001) horiz.set(0, 0, -1)

            // 2. Đặt mô hình ở cự ly 0.68 mét thẳng trước camera, hạ thấp vừa tầm mặt bàn (-0.22m)
            const spawnDist = 0.68
            modelAnchor.position.set(
                threeCamera.position.x + horiz.x * spawnDist,
                threeCamera.position.y - 0.22,
                threeCamera.position.z + horiz.z * spawnDist
            )

            // 3. Khóa mô hình đứng thẳng tuyệt đối (Upright) và hướng mặt chính về phía người dùng
            const angle = Math.atan2(
                threeCamera.position.x - modelAnchor.position.x,
                threeCamera.position.z - modelAnchor.position.z
            )
            modelAnchor.rotation.set(0, angle, 0)
        } else {
            modelAnchor.position.set(0, -0.22, -0.68)
            modelAnchor.rotation.set(0, 0, 0)
        }

        modelAnchor.visible = true
        isTargetFound.value = true
        addLog('[OK] Đã đặt model đứng thẳng trên mặt bàn')

        // Hiện hướng dẫn thao tác rồi tự ẩn
        showHint.value = true
        setTimeout(() => {
            showHint.value = false
        }, 4500)

        if (audioObj.value && !isPlaying.value) {
            audioObj.value.play().then(() => {
                isPlaying.value = true
            }).catch(() => {
                addLog('[WARN] Auto-play bị chặn, bấm icon loa để nghe')
            })
        }
    } catch (e: any) {
        addLog(`[ERR] Lỗi khi hiện model: ${e?.message || e}`)
    }
}

// Cử chỉ cảm ứng: 1 ngón Kéo di chuyển / Xoay, 2 ngón Zoom & Twist xoay
let touchStartX = 0
let touchStartY = 0
let initialPinchDistance = 0
let initialScaleAtPinch = 1.0
let initialPinchAngle: number | null = null

const handleTouchStart = (e: TouchEvent) => {
    if (e.touches.length === 1) {
        touchStartX = e.touches[0].clientX
        touchStartY = e.touches[0].clientY
    } else if (e.touches.length === 2) {
        const p1 = e.touches[0]
        const p2 = e.touches[1]
        const dx = p1.clientX - p2.clientX
        const dy = p1.clientY - p2.clientY
        initialPinchDistance = Math.hypot(dx, dy)
        initialScaleAtPinch = scaleMultiplier.value
        initialPinchAngle = Math.atan2(dy, dx)
    }
}

const handleTouchMove = (e: TouchEvent) => {
    if (!isTargetFound.value || !modelMesh) return

    if (e.touches.length === 1) {
        const curX = e.touches[0].clientX
        const curY = e.touches[0].clientY
        const deltaX = curX - touchStartX
        const deltaY = curY - touchStartY
        touchStartX = curX
        touchStartY = curY

        if (gestureMode.value === 'move') {
            // Di chuyển mô hình trên mặt phẳng ngang (X-Z) theo hướng nhìn của camera
            if (threeCamera) {
                const camForward = new THREE.Vector3(0, 0, -1).applyQuaternion(threeCamera.quaternion)
                const camRight = new THREE.Vector3(1, 0, 0).applyQuaternion(threeCamera.quaternion)
                const forwardHoriz = new THREE.Vector3(camForward.x, 0, camForward.z).normalize()
                const rightHoriz = new THREE.Vector3(camRight.x, 0, camRight.z).normalize()

                // Vuốt ngang màn hình -> trượt ngang trên bàn
                // Vuốt dọc màn hình -> trượt xa / gần trên bàn
                const speed = 0.0016
                modelAnchor.position.addScaledVector(rightHoriz, deltaX * speed)
                modelAnchor.position.addScaledVector(forwardHoriz, -deltaY * speed)
            }
        } else {
            // Xoay quanh trục Y cục bộ
            modelMesh.rotation.y += deltaX * 0.015
        }
    } else if (e.touches.length === 2 && initialPinchDistance > 0) {
        const p1 = e.touches[0]
        const p2 = e.touches[1]
        const dx = p1.clientX - p2.clientX
        const dy = p1.clientY - p2.clientY
        const currentDistance = Math.hypot(dx, dy)

        // Phóng to / Thu nhỏ
        if (initialPinchDistance > 0) {
            const factor = currentDistance / initialPinchDistance
            updateScale(initialScaleAtPinch * factor)
        }

        // Xoay 2 ngón (Twist)
        const currentAngle = Math.atan2(dy, dx)
        if (initialPinchAngle !== null) {
            const deltaAngle = currentAngle - initialPinchAngle
            modelMesh.rotation.y += deltaAngle
        }
        initialPinchAngle = currentAngle
    }
}

const handleTouchEnd = () => {
    initialPinchDistance = 0
    initialPinchAngle = null
}

const imageTrackingPipeline = () => {
    return {
        name: 'custom-image-tracking',
        onStart: () => {
            addLog('[OK] Pipeline onStart - Camera OK')
            isCameraReady.value = true

            try {
                const { scene, camera, renderer } = window.XR8.Threejs.xrScene()
                threeScene = scene
                threeCamera = camera

                // Đồng bộ kích thước renderer và tỷ lệ camera
                if (renderer) {
                    renderer.setSize(window.innerWidth, window.innerHeight, false)
                }
                if (camera) {
                    camera.aspect = window.innerWidth / window.innerHeight
                    camera.updateProjectionMatrix()
                }

                // Hệ thống ánh sáng nổi khối, rực rỡ, không bị tối mặt
                scene.add(new THREE.AmbientLight(0xffffff, 1.1))
                const hemiLight = new THREE.HemisphereLight(0xffffff, 0x334155, 0.8)
                scene.add(hemiLight)

                // Headlight gắn theo camera, luôn rọi sáng mặt trước mô hình ở mọi góc nhìn
                const headLight = new THREE.DirectionalLight(0xffffff, 1.6)
                headLight.position.set(0, 2, 2)
                camera.add(headLight)
                scene.add(camera)

                // Đổ bóng tiếp xúc mặt bàn
                shadowMesh = createContactShadow(0.5)
                modelAnchor.add(shadowMesh)

                // Ban đầu ẩn model anchor
                modelAnchor.visible = false
                scene.add(modelAnchor)

                // Tải Model 3D
                if (props.locationData.modelUrl) {
                    addLog(`[INFO] Tải model: ${props.locationData.modelUrl}`)

                    MeshoptDecoder.ready.then(() => {
                        const loader = new GLTFLoader()
                        loader.setMeshoptDecoder(MeshoptDecoder)

                        loader.load(
                            props.locationData.modelUrl,
                            (gltf) => {
                                const rawModel = gltf.scene

                                const box = new THREE.Box3().setFromObject(rawModel)
                                const size = new THREE.Vector3()
                                box.getSize(size)
                                const center = new THREE.Vector3()
                                box.getCenter(center)

                                // Căn giữa tâm đáy của mô hình tại y = 0
                                rawModel.position.set(-center.x, -box.min.y, -center.z)

                                const maxDim = Math.max(size.x, size.y, size.z)
                                const TARGET_SIZE_METERS = 0.52 // ~52cm: Kích thước để bàn / sa bàn vừa vặn
                                const configScale = props.locationData.modelConfig?.scale || 1.0
                                baseModelScale.value = (maxDim > 0 ? (TARGET_SIZE_METERS / maxDim) : 1.0) * configScale

                                modelMesh = new THREE.Group()
                                modelMesh.add(rawModel)

                                const pos = props.locationData.modelConfig?.position || { x: 0, y: 0, z: 0 }
                                modelMesh.position.set(pos.x, pos.y, pos.z)

                                const rot = props.locationData.modelConfig?.rotation || { x: 0, y: 0, z: 0 }
                                modelMesh.rotation.set(rot.x, rot.y, rot.z)

                                applyScale()

                                modelAnchor.add(modelMesh)
                                isModelLoaded.value = true
                                loadProgress.value = 100
                                addLog('[OK] Model 3D OK')
                            },
                            (xhr) => {
                                if (xhr.total > 0) {
                                    loadProgress.value = Math.round((xhr.loaded / xhr.total) * 100)
                                }
                            },
                            (err: any) => addLog(`[ERR] Lỗi model: ${err?.message || err}`)
                        )
                    }).catch(err => {
                        addLog(`[ERR] Lỗi khởi tạo bộ nén Meshopt: ${err?.message || err}`)
                    })
                }

                // Tải Audio
                if (props.locationData.audioUrl) {
                    audioObj.value = new Audio(props.locationData.audioUrl)
                    audioObj.value.loop = true
                    addLog('[OK] Audio OK')
                }
            } catch (err: any) {
                addLog(`[ERR] onStart error: ${err?.message || err}`)
            }
        },

        onException: (err: any) => {
            addLog(`[ERR] Pipeline error: ${err?.message || err}`)
            errorMessage.value = `Pipeline lỗi: ${err?.message || err}`
        },

        listeners: [
            {
                event: 'reality.imagefound',
                process: (event: any) => {
                    addLog(`[INFO] imagefound: "${event.detail.name}"`)
                    if (event.detail.name === props.locationData.targetId) {
                        isTargetFound.value = true
                        modelAnchor.visible = true
                        modelAnchor.position.copy(event.detail.position)
                        // Giữ mô hình luôn đứng thẳng song song trọng lực (Upright Lock)
                        const targetEuler = new THREE.Euler().setFromQuaternion(event.detail.rotation, 'YXZ')
                        modelAnchor.rotation.set(0, targetEuler.y, 0)

                        showHint.value = true
                        setTimeout(() => { showHint.value = false }, 4500)

                        if (audioObj.value && !isPlaying.value) {
                            audioObj.value.play().then(() => {
                                isPlaying.value = true
                            }).catch(() => {
                                addLog('[WARN] Auto-play bị chặn, bấm icon loa để nghe')
                            })
                        }
                    }
                }
            },
            {
                event: 'reality.imageupdated',
                process: (event: any) => {
                    if (modelAnchor && modelAnchor.visible) {
                        modelAnchor.position.copy(event.detail.position)
                        const targetEuler = new THREE.Euler().setFromQuaternion(event.detail.rotation, 'YXZ')
                        modelAnchor.rotation.set(0, targetEuler.y, 0)
                    }
                }
            },
            {
                event: 'reality.imagelost',
                process: () => {
                    addLog('[INFO] imagelost')
                }
            }
        ]
    }
}

// Đồng bộ kích thước canvas với màn hình thực tế (chống viền đen và lệch tỷ lệ)
const syncCanvasSize = () => {
    if (!arCanvas.value) return
    const w = window.innerWidth
    const h = window.innerHeight

    arCanvas.value.width = w
    arCanvas.value.height = h

    try {
        if (window.XR8?.Threejs) {
            const sceneObj = window.XR8.Threejs.xrScene()
            if (sceneObj?.renderer) {
                sceneObj.renderer.setSize(w, h, false)
            }
            if (sceneObj?.camera) {
                sceneObj.camera.aspect = w / h
                sceneObj.camera.updateProjectionMatrix()
            }
        }
    } catch (_e) { /* ignore */ }
}

const startAR = () => {
    addLog('[INFO] startAR()')
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

        syncCanvasSize()

        window.XR8.addCameraPipelineModules([
            window.XR8.GlTextureRenderer.pipelineModule(),
            window.XR8.Threejs.pipelineModule(),
            window.XR8.XrController.pipelineModule(),
            imageTrackingPipeline(),
            {
                name: 'responsive-camera-feed-canvas',
                onStart: () => syncCanvasSize(),
                onCanvasSizeChange: () => syncCanvasSize(),
                onDeviceOrientationChange: () => setTimeout(syncCanvasSize, 150)
            }
        ])

        if (window.XR8.XrController.configure) {
            window.XR8.XrController.configure({ disableWorldTracking: false })
        }

        window.XR8.run({
            canvas: arCanvas.value,
            allowedDevices: window.XR8.XrConfig?.device?.().ANY,
        })
        addLog('[OK] XR8.run() OK')
    } catch (err: any) {
        addLog(`[ERR] ${err?.message || err}`)
        errorMessage.value = `Lỗi: ${err?.message || err}`
    }
}

onMounted(() => {
    addLog('[INFO] onMounted')
    syncCanvasSize()
    window.addEventListener('resize', syncCanvasSize)
    window.addEventListener('orientationchange', () => {
        setTimeout(syncCanvasSize, 150)
    })

    if (window.XR8) {
        startAR()
    } else {
        addLog('[INFO] Chờ xrloaded...')
        window.addEventListener('xrloaded', () => {
            addLog('[OK] xrloaded fired')
            startAR()
        }, { once: true })
    }
})

onBeforeUnmount(() => {
    window.removeEventListener('resize', syncCanvasSize)
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
    if (threeScene) {
        while (threeScene.children.length > 0) {
            threeScene.remove(threeScene.children[0])
        }
    }
})
</script>

<template>
    <div class="fixed inset-0 w-full h-[100dvh] overflow-hidden bg-black select-none"
        @touchstart="handleTouchStart" @touchmove="handleTouchMove" @touchend="handleTouchEnd">
        <!-- Camera Canvas: Chiếm toàn màn hình -->
        <canvas ref="arCanvas" class="absolute inset-0 w-full h-full object-cover block" style="z-index: 0;"></canvas>

        <!-- ===== THÔNG BÁO HƯỚNG DẪN THAO TÁC (Tự ẩn sau 4s) ===== -->
        <transition name="fade">
            <div v-if="isTargetFound && showHint && !isUiHidden"
                class="absolute top-16 left-1/2 -translate-x-1/2 z-30 pointer-events-none
                       bg-black/60 backdrop-blur-md px-3.5 py-1.5 rounded-full border border-white/20
                       text-[11px] text-white/95 font-medium whitespace-nowrap shadow-xl flex items-center gap-1.5">
                <Lightbulb :size="13" class="text-amber-400 flex-shrink-0" />
                <span>{{ gestureMode === 'move' ? '1 ngón kéo để di chuyển' : '1 ngón vuốt để xoay' }} • 2 ngón zoom & xoay</span>
            </div>
        </transition>

        <!-- ===== BỘ ĐIỀU KHIỂN NỔI BÊN PHẢI (Chỉ hiện khi đã tải mô hình) ===== -->
        <div v-if="isTargetFound && !isUiHidden"
            class="absolute right-3.5 bottom-20 z-30 flex flex-col items-end gap-2 pointer-events-auto">
            <!-- Nút chuyển đổi chế độ: Di chuyển / Xoay -->
            <button @click.stop="gestureMode = (gestureMode === 'move' ? 'rotate' : 'move')"
                class="flex items-center gap-1.5 px-3 py-1.5 rounded-full backdrop-blur-xl border text-xs font-semibold shadow-lg transition active:scale-95"
                :class="gestureMode === 'move' 
                    ? 'bg-blue-600/85 border-blue-400/50 text-white shadow-blue-500/30' 
                    : 'bg-amber-600/85 border-amber-400/50 text-white shadow-amber-500/30'">
                <Move v-if="gestureMode === 'move'" :size="13" />
                <RotateCw v-else :size="13" />
                <span>{{ gestureMode === 'move' ? 'Di chuyển' : 'Xoay' }}</span>
            </button>

            <!-- Nút Zoom thu nhỏ/phóng to dạng viên thuốc siêu gọn -->
            <div class="flex items-center gap-1 bg-black/60 backdrop-blur-xl px-2 py-1 rounded-full border border-white/20 text-white shadow-lg">
                <button @click.stop="zoomOut" title="Thu nhỏ"
                    class="w-6 h-6 flex items-center justify-center bg-white/10 hover:bg-white/20 active:scale-90 rounded-full text-xs font-bold transition">
                    <Minus :size="12" />
                </button>
                <div @click.stop="resetScale" title="Bấm để về 100%"
                    class="px-1 text-[11px] font-mono font-bold text-blue-400 cursor-pointer select-none active:scale-95 transition">
                    {{ Math.round(scaleMultiplier * 100) }}%
                </div>
                <button @click.stop="zoomIn" title="Phóng to"
                    class="w-6 h-6 flex items-center justify-center bg-white/10 hover:bg-white/20 active:scale-90 rounded-full text-xs font-bold transition">
                    <Plus :size="12" />
                </button>
            </div>
        </div>

        <!-- ===== THANH ĐIỀU KHIỂN DƯỚI CÙNG: DẠNG VIÊN THUỐC CAPSULE CỰC KỲ GỌN GÀNG ===== -->
        <div v-if="isTargetFound && !isUiHidden"
            class="absolute bottom-5 left-4 right-4 z-30
                   bg-slate-900/80 backdrop-blur-2xl border border-white/20 text-white
                   px-3.5 py-2 rounded-full shadow-2xl flex items-center justify-between gap-2.5 transition-all">
            <!-- Tên địa danh (Bấm để xem chi tiết thông tin) -->
            <button @click.stop="showDetailModal = true"
                class="flex items-center gap-2 min-w-0 pr-1 text-left active:opacity-75 transition">
                <Landmark :size="16" class="text-blue-400 flex-shrink-0" />
                <span class="text-xs font-bold text-white truncate max-w-[150px] sm:max-w-none">
                    {{ locationData.name }}
                </span>
                <span class="text-[10px] bg-white/15 text-blue-300 font-semibold px-2 py-0.5 rounded-full">
                    Chi tiết
                </span>
            </button>

            <!-- Cụm nút chức năng tiện ích -->
            <div class="flex items-center gap-1.5 flex-shrink-0">
                <!-- Nút Đặt lại vị trí giữa tầm mắt -->
                <button @click.stop="skipAndShowModel" title="Đưa mô hình về giữa bàn"
                    class="w-8 h-8 flex items-center justify-center bg-white/10 hover:bg-white/20 active:scale-90 rounded-full text-white transition">
                    <LocateFixed :size="15" />
                </button>
                <!-- Nút Âm thanh -->
                <button @click.stop="toggleAudio" title="Bật/Tắt âm thanh thuyết minh"
                    class="w-8 h-8 flex items-center justify-center bg-white/10 hover:bg-white/20 active:scale-90 rounded-full transition">
                    <Volume2 v-if="isPlaying" :size="15" class="text-emerald-400" />
                    <VolumeX v-else :size="15" class="text-gray-300" />
                </button>
                <!-- Nút Ẩn toàn bộ UI để chụp ảnh / ngắm không gian sạch -->
                <button @click.stop="isUiHidden = true" title="Ẩn giao diện"
                    class="w-8 h-8 flex items-center justify-center bg-white/10 hover:bg-white/20 active:scale-90 rounded-full text-white transition">
                    <Eye :size="14" />
                </button>
            </div>
        </div>

        <!-- ===== NÚT MỞ LẠI GIAO DIỆN (Khi đã ẩn UI) ===== -->
        <button v-if="isTargetFound && isUiHidden" @click="isUiHidden = false"
            class="absolute bottom-5 right-5 z-40 px-3.5 py-2 bg-black/60 backdrop-blur-xl border border-white/25
                   text-white text-xs font-semibold rounded-full shadow-2xl flex items-center gap-1.5 active:scale-95 transition">
            <Eye :size="14" />
            <span>Hiện công cụ</span>
        </button>

        <!-- ===== MODAL CHI TIẾT THÔNG TIN ĐỊA DANH (Chỉ hiện khi bấm Chi tiết) ===== -->
        <transition name="fade">
            <div v-if="showDetailModal"
                class="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-4"
                @click.self="showDetailModal = false">
                <div class="w-full max-w-md bg-slate-900/95 border border-white/20 text-white rounded-3xl p-5 shadow-2xl space-y-3.5 animate-slide-up">
                    <div class="flex items-center justify-between border-b border-white/10 pb-3">
                        <div class="flex items-center gap-2">
                            <Landmark :size="18" class="text-blue-400 flex-shrink-0" />
                            <h3 class="text-base font-bold text-white">{{ locationData.name }}</h3>
                        </div>
                        <button @click="showDetailModal = false"
                            class="w-7 h-7 flex items-center justify-center bg-white/10 hover:bg-white/20 active:scale-90 rounded-full text-white transition">
                            <X :size="14" />
                        </button>
                    </div>

                    <p class="text-xs text-slate-300 leading-relaxed max-h-48 overflow-y-auto pr-1">
                        {{ locationData.description }}
                    </p>

                    <div class="flex gap-2.5 pt-2">
                        <a :href="locationData.mapsUrl" target="_blank"
                            class="flex-1 bg-blue-600 hover:bg-blue-500 text-white text-center py-2.5 rounded-xl font-bold text-xs shadow active:scale-98 transition flex items-center justify-center gap-1.5">
                            <MapPin :size="14" />
                            <span>Mở chỉ đường Google Maps</span>
                        </a>
                        <button @click="showDetailModal = false"
                            class="px-4 py-2.5 bg-white/10 hover:bg-white/20 text-white rounded-xl text-xs font-bold active:scale-98 transition">
                            Đóng
                        </button>
                    </div>
                </div>
            </div>
        </transition>

        <!-- ===== LAYER: Loading Camera overlay ===== -->
        <div v-if="!isCameraReady && !errorMessage"
            class="absolute inset-0 z-10 flex flex-col items-center justify-center bg-gray-900 text-white">
            <div class="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4"></div>
            <p class="text-lg font-bold">Đang khởi động Camera...</p>
            <p class="text-xs text-gray-400 mt-1">Vui lòng chấp nhận quyền Camera nếu được hỏi</p>
        </div>

        <!-- ===== LAYER: Error overlay ===== -->
        <div v-if="errorMessage"
            class="absolute inset-0 z-10 flex flex-col items-center justify-center bg-gray-900 text-white px-8">
            <AlertTriangle :size="36" class="text-amber-400 mb-3" />
            <p class="text-base font-bold text-red-400 mb-1">Lỗi khởi động AR</p>
            <p class="text-xs text-gray-300 text-center mb-5">{{ errorMessage }}</p>
            <button @click="startAR()" class="px-5 py-2.5 bg-blue-600 text-white font-bold text-sm rounded-xl active:bg-blue-700 flex items-center gap-1.5">
                <RefreshCw :size="14" />
                <span>Thử lại</span>
            </button>
        </div>

        <!-- ===== LAYER: Scanning guide (CHỈ hiện khi chưa nhận diện hoặc chưa skip) ===== -->
        <div v-if="isCameraReady && !isTargetFound"
            class="absolute inset-0 z-20 flex flex-col items-center justify-center pointer-events-none">
            <div class="w-52 h-52 border-[3px] border-dashed border-white/60 rounded-3xl flex items-center justify-center">
                <div class="w-10 h-10 border-t-2 border-l-2 border-white/40"></div>
            </div>
            <p class="mt-4 text-xs font-semibold text-white text-center drop-shadow-lg
                       bg-black/50 px-4 py-1.5 rounded-full backdrop-blur-sm flex items-center gap-1.5">
                <Camera :size="13" />
                <span>Hướng camera vào con dấu</span>
            </p>

            <!-- Nút Bỏ qua bước quét -->
            <div class="mt-7 pointer-events-auto flex flex-col items-center px-6 w-full max-w-xs">
                <button @click="skipAndShowModel" :disabled="!isModelLoaded"
                    class="w-full py-3 px-5 rounded-2xl font-bold text-white text-sm shadow-xl transition-all flex items-center justify-center gap-2 active:scale-95"
                    :class="isModelLoaded ? 'bg-gradient-to-r from-blue-600 to-indigo-600 shadow-blue-500/40' : 'bg-gray-800/80 text-gray-300 backdrop-blur-sm cursor-not-allowed'">
                    <span v-if="!isModelLoaded"
                        class="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                    <Sparkles v-else :size="15" class="text-amber-300" />
                    <span>{{ isModelLoaded ? 'Bỏ qua quét (Hiện 3D ngay)' : `Đang tải 3D (${loadProgress}%)...` }}</span>
                </button>
                <p class="text-[11px] text-white/70 mt-1.5 text-center drop-shadow">
                    Đặt mô hình thẳng đứng ngay trước mặt bàn
                </p>
            </div>
        </div>

        <!-- ===== NÚT BACK (Góc trên trái) ===== -->
        <button @click="$emit('back')" class="absolute top-5 left-5 z-40
                   w-9 h-9 bg-black/50 backdrop-blur-md text-white rounded-full
                   flex items-center justify-center shadow-lg active:scale-90 transition">
            <X :size="16" />
        </button>

        <!-- ===== NÚT LOG (Góc trên phải, nhỏ gọn) ===== -->
        <button @click="showDebug = !showDebug" class="absolute top-5 right-5 z-40
                   w-9 h-9 bg-black/50 backdrop-blur-md text-white/70 rounded-full
                   flex items-center justify-center shadow active:scale-90 transition">
            <X v-if="showDebug" :size="14" />
            <Bug v-else :size="14" />
        </button>

        <!-- ===== DEBUG LOG PANEL ===== -->
        <div v-if="showDebug" class="absolute top-16 right-3 left-3 z-50
                   max-h-48 overflow-y-auto bg-black/90 backdrop-blur-md
                   text-green-400 text-[10px] font-mono p-3 rounded-2xl leading-snug border border-white/10">
            <div v-for="(log, i) in debugLogs" :key="i">{{ log }}</div>
            <div v-if="!debugLogs.length" class="text-gray-500">Chờ log...</div>
        </div>
    </div>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
    transition: opacity 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
    opacity: 0;
}
</style>