cmake_minimum_required(VERSION 3.20)
project(easywar_runner LANGUAGES C CXX)

# Рушій локальної мовної моделі КОМБАТА: тонка оболонка над llama.cpp.
# Збирається в один самодостатній виконуваний файл без мережі та без GPU:
# застосунок кладе його поруч із моделлю й говорить із ним JSON-рядками через stdin/stdout
# (протокол — docs/ASSISTANT.md, розділ про рушій).

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
if(NOT CMAKE_BUILD_TYPE AND NOT CMAKE_CONFIGURATION_TYPES)
  set(CMAKE_BUILD_TYPE Release)
endif()

# Статичне C-середовище MSVC: рушій не вимагає встановленого Visual C++ Redistributable.
if(MSVC)
  set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
endif()

# Прибираємо все зайве з llama.cpp: лише бібліотека, статично.
set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
set(LLAMA_STANDALONE OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_COMMON OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_TOOLS OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_SERVER OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_APP OFF CACHE BOOL "" FORCE)
set(LLAMA_OPENSSL OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_MTMD OFF CACHE BOOL "" FORCE)
set(GGML_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(GGML_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)

# Лише процесор. Збірка переносима: без -march=native, щоб не падати на іншому ЦП.
# На x86_64 це AVX2/FMA/F16C (див. перевірку ЦП на початку main.cpp); на arm64 — базовий NEON.
set(GGML_NATIVE OFF CACHE BOOL "" FORCE)
set(GGML_OPENMP OFF CACHE BOOL "" FORCE)
set(GGML_METAL OFF CACHE BOOL "" FORCE)
set(GGML_BLAS OFF CACHE BOOL "" FORCE)
set(GGML_CUDA OFF CACHE BOOL "" FORCE)
set(GGML_VULKAN OFF CACHE BOOL "" FORCE)
set(GGML_HIP OFF CACHE BOOL "" FORCE)
set(GGML_SYCL OFF CACHE BOOL "" FORCE)
set(GGML_OPENCL OFF CACHE BOOL "" FORCE)
set(GGML_RPC OFF CACHE BOOL "" FORCE)
set(GGML_CCACHE OFF CACHE BOOL "" FORCE)

include(FetchContent)
# Версія llama.cpp зафіксована тегом і перевіряється за хешем коміту (захист від підміни тега).
# Для збірки без мережі: -DFETCHCONTENT_SOURCE_DIR_LLAMA=<локальна копія тієї самої версії>.
set(LLAMA_CPP_TAG b11715)
set(LLAMA_CPP_COMMIT 9d1878a4354e743529fbe09e7350a957f5e39e9a)
FetchContent_Declare(
  llama
  GIT_REPOSITORY https://github.com/ggml-org/llama.cpp.git
  GIT_TAG ${LLAMA_CPP_TAG}
  GIT_SHALLOW TRUE
)
FetchContent_MakeAvailable(llama)

# Пакетна («unity») збірка llama.cpp склеює файли й на машині з 7 ГБ ОЗП (macOS-раннер) вбиває компілятор.
set_target_properties(llama PROPERTIES UNITY_BUILD OFF)

find_package(Git QUIET)
if(NOT GIT_FOUND)
  message(FATAL_ERROR "Потрібен git, щоб перевірити версію llama.cpp")
endif()
execute_process(
  COMMAND "${GIT_EXECUTABLE}" -C "${llama_SOURCE_DIR}" rev-parse HEAD
  OUTPUT_VARIABLE LLAMA_CPP_ACTUAL_COMMIT
  OUTPUT_STRIP_TRAILING_WHITESPACE
  RESULT_VARIABLE LLAMA_CPP_REVPARSE_RESULT
  ERROR_QUIET
)
if(NOT LLAMA_CPP_REVPARSE_RESULT EQUAL 0 OR NOT LLAMA_CPP_ACTUAL_COMMIT STREQUAL LLAMA_CPP_COMMIT)
  message(FATAL_ERROR
    "llama.cpp ${LLAMA_CPP_TAG}: очікувався коміт ${LLAMA_CPP_COMMIT}, а отримано '${LLAMA_CPP_ACTUAL_COMMIT}'")
endif()

add_executable(runner main.cpp)
target_include_directories(runner SYSTEM PRIVATE "${llama_SOURCE_DIR}/vendor")
target_link_libraries(runner PRIVATE llama)
set_target_properties(runner PROPERTIES OUTPUT_NAME runner)

if(MSVC)
  target_compile_options(runner PRIVATE /W4 /utf-8)
  target_compile_definitions(runner PRIVATE _CRT_SECURE_NO_WARNINGS NOMINMAX)
  # Консольний режим: вікно не потрібне, застосунок запускає рушій з CREATE_NO_WINDOW.
  target_link_options(runner PRIVATE /SUBSYSTEM:CONSOLE)
else()
  target_compile_options(runner PRIVATE -Wall -Wextra)
endif()

# Прибираємо символи з релізного файлу, щоб він був меншим.
if(NOT MSVC AND CMAKE_BUILD_TYPE STREQUAL "Release")
  if(APPLE)
    target_link_options(runner PRIVATE -Wl,-dead_strip -Wl,-x)
  else()
    target_link_options(runner PRIVATE -Wl,--gc-sections -s)
  endif()
endif()
