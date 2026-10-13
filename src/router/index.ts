import { createRouter, createWebHistory } from 'vue-router'
import Home from '../views/Home.vue'
import ARView from '../views/ARView.vue'

const router = createRouter({
    history: createWebHistory(),
    routes: [
        {
            path: '/',
            name: 'home',
            component: Home
        },
        {
            path: '/ar/:id',
            name: 'ar-experience',
            component: ARView
        }
    ]
})

export default router