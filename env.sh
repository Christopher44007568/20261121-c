# Source this file: source ./env.sh
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export VULKAN_SDK_LOCAL="$HOME/local/root"
export CPLUS_INCLUDE_PATH="$VULKAN_SDK_LOCAL/usr/include:$CPLUS_INCLUDE_PATH"
export LIBRARY_PATH="$VULKAN_SDK_LOCAL/usr/lib/x86_64-linux-gnu:$LIBRARY_PATH"
export LD_LIBRARY_PATH="$VULKAN_SDK_LOCAL/usr/lib/x86_64-linux-gnu:$LD_LIBRARY_PATH"
export PATH="$VULKAN_SDK_LOCAL/usr/bin:$PATH"
# llvmpipe software rendering (headless / WSLg)
export VK_ICD_FILENAMES="$VULKAN_SDK_LOCAL/usr/share/vulkan/icd.d/lvp_icd.json"
export LP_NATIVE_CPU=1
