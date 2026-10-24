/**
 * Chromium launch options shared by the headless tools.
 *   default   SwiftShader (CPU rasteriser; works anywhere, slow)
 *   GPU=1     the real GPU through ANGLE/Vulkan (Ubuntu + NVIDIA proprietary driver); add HEADED=1 for a
 *             visible window if the headless shell refuses the GPU on your driver stack
 *   FLAGS     extra Chromium switches, space separated
 */
export function launchOptions(extra = []) {
  const gpu = process.env.GPU === '1';
  const args = gpu
    ? ['--use-angle=vulkan', '--enable-features=Vulkan,VulkanFromANGLE,DefaultANGLEVulkan', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--disable-dev-shm-usage']
    : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'];
  return {
    headless: process.env.HEADED !== '1',
    args: [...args, ...extra, ...(process.env.FLAGS ? process.env.FLAGS.split(' ').filter(Boolean) : [])],
  };
}
