<template>
    <div class="min-h-screen bg-gray-50 pb-10">
        <!-- Header -->
        <div class="bg-white shadow-sm pt-12 pb-8 px-6 text-center mb-6 rounded-b-3xl">
            <h1 class="text-3xl font-extrabold text-blue-700 mb-2 drop-shadow-sm">Sổ Tay Di Sản</h1>
            <p class="text-gray-500 text-sm">Chọn một địa danh để xem 3D</p>
        </div>

        <!-- Màn hình Loading khi đang đọc thư mục -->
        <div v-if="isLoading" class="flex justify-center items-center h-40">
            <div class="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
        </div>

        <!-- Lưới danh sách địa danh -->
        <div v-else class="px-5 grid grid-cols-2 gap-4 max-w-md mx-auto">
            <button v-for="loc in locations" :key="loc.id" @click="goToAR(loc.id)"
                class="bg-white rounded-2xl shadow border border-gray-100 overflow-hidden flex flex-col active:scale-95 transition-transform text-left">
                <!-- Ảnh đại diện ô vuông -->
                <div class="w-full aspect-square bg-gray-200">
                    <img :src="loc.imageUrl" :alt="loc.name" class="w-full h-full object-cover" loading="lazy" />
                </div>

                <!-- Tên địa danh -->
                <div class="p-3">
                    <h3 class="font-bold text-gray-800 text-sm line-clamp-2 leading-tight">
                        {{ loc.name }}
                    </h3>
                </div>
            </button>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'

const router = useRouter()
const isLoading = ref(true)
const locations = ref<any[]>([])

// Tự động load danh sách từ các folder (dựa theo cấu trúc bạn đã chụp)
onMounted(async () => {
    const folderNames = ['chua-mot-cot', 'cot-co-lung-cu']
    const loadedData = []

    for (const folder of folderNames) {
        try {
            // Đọc file info.json
            const res = await fetch(`/data/${folder}/info.json?t=${new Date().getTime()}`)
            if (res.ok) {
                const data = await res.json()

                // Bổ sung đường dẫn ảnh dựa theo cấu trúc folder public/data/...
                loadedData.push({
                    id: data.id || folder,
                    name: data.name,
                    imageUrl: `/data/${folder}/image.jpg`
                })
            }
        } catch (error) {
            console.error(`Không tải được data của ${folder}:`, error)
        }
    }

    locations.value = loadedData
    isLoading.value = false
})

const goToAR = (id: string) => {
    router.push(`/ar/${id}`)
}
</script>