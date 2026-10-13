<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ARCanvas from '../components/ARCanvas.vue'

const route = useRoute()
const router = useRouter()

const locationData = ref<any>(null)
const isLoading = ref(true)

onMounted(async () => {
    // Lấy id từ URL (ví dụ: chua-mot-cot)
    const folderName = route.params.id as string

    try {
        const response = await fetch(`/data/${folderName}/info.json?t=${new Date().getTime()}`)
        if (!response.ok) throw new Error('Không tìm thấy file data')
        locationData.value = await response.json()
    } catch (error) {
        console.error('Lỗi tải data:', error)
    } finally {
        isLoading.value = false
    }
})

const handleBack = () => {
    router.push('/')
}
</script>
<template>
    <div class="w-full h-screen bg-gray-900 font-sans">

        <!-- Màn hình Loading -->
        <div v-if="isLoading" class="h-full flex flex-col items-center justify-center text-white">
            <div class="w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-6"></div>
            <p class="text-2xl font-semibold animate-pulse">Đang tải dữ liệu...</p>
        </div>

        <!-- Màn hình AR (Chỉ render khi đã fetch xong data) -->
        <ARCanvas v-else-if="locationData" :locationData="locationData" @back="handleBack" />

        <!-- Báo lỗi nếu gõ sai tên địa danh trên URL hoặc không tìm thấy file -->
        <div v-else class="h-full flex flex-col items-center justify-center text-white">
            <p class="text-xl mb-4 text-red-400">Không tìm thấy dữ liệu địa danh.</p>
            <button @click="handleBack" class="px-6 py-2 bg-white text-black font-bold rounded-xl">Quay lại trang
                chủ</button>
        </div>

    </div>
</template>
