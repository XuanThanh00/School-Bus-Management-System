# Hướng Dẫn Yocto Project Toàn Diện
## Dành cho người mới bắt đầu — Target: Raspberry Pi 5 — Host: Windows + WSL2/Debian
### Yocto version: Scarthgap (5.0 LTS)

---

## PHẦN 1 — YOCTO LÀ GÌ VÀ TẠI SAO CẦN NÓ

### Vấn đề mà Yocto giải quyết

Khi làm một dự án nhúng thông thường với Raspberry Pi, bạn thường tải về Raspberry Pi OS (Raspbian) — một hệ điều hành đầy đủ với hàng nghìn package, desktop environment, các dịch vụ nền chạy song song, và rất nhiều thứ mà thiết bị nhúng của bạn không bao giờ cần tới. Đây không phải vấn đề khi bạn học tập hay prototype, nhưng khi đưa vào sản phẩm thực tế, nó trở thành gánh nặng: khởi động chậm, tốn RAM, tốn flash, bề mặt tấn công bảo mật lớn, và khó kiểm soát chính xác những gì đang chạy trên thiết bị.

Yocto Project ra đời để giải quyết bài toán này. Thay vì *lấy một hệ điều hành đầy đủ rồi bỏ bớt đi*, Yocto để bạn *xây dựng từ đầu* một Linux image chỉ chứa đúng những gì bạn cần. Kernel, rootfs, bootloader, từng package — tất cả đều được compile từ source code theo đúng cấu hình bạn chỉ định. Kết quả là một image gọn nhẹ, có thể kiểm soát hoàn toàn, và hoàn toàn tái tạo được (reproducible build).

Nói đơn giản hơn: Raspbian là chiếc áo may sẵn, còn Yocto là xưởng may — bạn chỉ định từng thước vải, từng đường chỉ.

### Yocto vs Buildroot — nên chọn cái nào?

Buildroot là một công cụ tương tự cũng cho phép build Linux nhúng từ source. Câu hỏi "nên dùng cái nào" rất phổ biến khi mới bắt đầu, và câu trả lời phụ thuộc vào mục tiêu của bạn.

Buildroot đơn giản hơn nhiều. Nếu bạn chỉ cần một image nhỏ chạy đúng ứng dụng của mình và không cần package manager hay khả năng update sau này, Buildroot sẽ cho bạn kết quả nhanh hơn với độ phức tạp thấp hơn.

Yocto mạnh hơn nhưng phức tạp hơn đáng kể. Nó hỗ trợ package management (opkg/rpm/deb), SDK để cross-compile ứng dụng, tái sử dụng layer giữa nhiều dự án, và cộng đồng BSP (Board Support Package) rất lớn. Đây là lý do Yocto được chọn cho các sản phẩm thương mại nghiêm túc.

Với dự án xe buýt của bạn — Raspberry Pi 5, Python, camera, RFID, audio — Yocto là lựa chọn phù hợp vì meta-raspberrypi layer đã có sẵn BSP cho Pi 5, và bạn có thể build một image tối ưu chứa đúng những gì cần thiết.

### Các khái niệm cốt lõi

Trước khi đụng vào bất kỳ lệnh nào, bạn cần hiểu rõ 7 khái niệm sau. Đây là nền tảng — nếu hiểu sai những thứ này, mọi bước sau sẽ rất khó hiểu.

**Poky** là reference distribution của Yocto Project. Nó là một tập hợp các tool và metadata mẫu để bạn bắt đầu. Khi bạn `git clone` Yocto, thực ra bạn đang clone Poky. Poky bao gồm BitBake (build engine), meta (layer cơ bản), meta-poky (distro config), và meta-yocto-bsp (một số BSP mẫu).

**BitBake** là build engine — trái tim của Yocto. Nó đọc các file recipe, tính toán dependency graph, rồi thực thi các task theo đúng thứ tự. Bạn có thể hình dung BitBake giống như `make` nhưng thông minh hơn nhiều: nó biết cache kết quả, chạy song song, và xử lý cross-compilation tự động.

**Layer** là đơn vị tổ chức metadata trong Yocto. Mọi thứ trong Yocto đều được tổ chức thành layer — một thư mục có cấu trúc nhất định chứa recipe, config, và file patch. Tại sao lại dùng layer? Vì nó cho phép tách biệt rõ ràng: BSP của Raspberry Pi nằm trong một layer riêng, ứng dụng của bạn nằm trong layer riêng của bạn, và bạn có thể mix-and-match mà không bị lẫn lộn. Layer có tên bắt đầu bằng `meta-` theo convention.

**Recipe** là file mô tả cách build một package cụ thể. Mỗi recipe (đuôi `.bb`) chứa thông tin như: lấy source code từ đâu, patch nào cần apply, cách compile, cách cài vào rootfs. Mỗi recipe tương ứng với một phần mềm — ví dụ `python3_3.12.bb`, `opencv_4.8.bb`, hay ứng dụng của chính bạn.

**Image** là recipe đặc biệt mô tả toàn bộ filesystem image sẽ được tạo ra. Nó không compile code mà liệt kê danh sách các package sẽ được đưa vào image. `core-image-minimal` là image nhỏ nhất, `core-image-full-cmdline` có thêm các tool command line, và bạn có thể tạo image riêng của mình.

**Machine** mô tả phần cứng target — cụ thể là `raspberrypi5`. Machine config chỉ định CPU architecture, bootloader, kernel config, và các thiết lập hardware khác. Đây là thứ BitBake dùng để biết phải compile cho kiến trúc nào (ARM64 cho Pi 5).

**Distro** (distribution) định nghĩa các tính năng ở mức OS — libc nào dùng (glibc hay musl), init system (systemd hay sysvinit), các tính năng toàn cục như SELinux, wayland, v.v. Poky là distro mặc định và phù hợp cho hầu hết trường hợp.

---

## PHẦN 2 — KIẾN TRÚC VÀ WORKFLOW

### Từ recipe đến image — BitBake làm gì?

Khi bạn chạy `bitbake core-image-minimal`, BitBake thực hiện một chuỗi task cho từng recipe theo thứ tự dependency. Hiểu được chuỗi này giúp bạn biết lỗi đang xảy ra ở đâu khi build thất bại.

```
do_fetch       → Tải source code về (từ git, http, local file...)
do_unpack      → Giải nén vào thư mục work
do_patch       → Apply các file .patch
do_configure   → Chạy ./configure hoặc cmake
do_compile     → Chạy make / ninja / python setup.py build
do_install     → Cài vào staging area (không phải rootfs thật)
do_package     → Đóng gói thành .rpm / .ipk / .deb
do_rootfs      → Tập hợp các package vào rootfs
do_image       → Tạo file image (ext4, squashfs, rpi-sdimg...)
```

Mỗi task này có thể được cache riêng biệt. Nếu bạn thay đổi recipe và chỉ ảnh hưởng đến `do_compile`, BitBake sẽ chạy lại từ `do_compile` trở đi mà không cần fetch hay patch lại.

### Cấu trúc thư mục build

Sau khi chạy `source oe-init-build-env`, bạn sẽ có một thư mục `build/` với cấu trúc như sau:

```
build/
├── conf/
│   ├── local.conf       ← Cấu hình chính của bạn (MACHINE, threads, v.v.)
│   └── bblayers.conf    ← Danh sách các layer đang dùng
├── tmp/
│   ├── work/            ← Nơi từng recipe được build (rất lớn)
│   │   └── cortexa76-poky-linux/   ← Theo architecture
│   │       └── python3/3.12/       ← Theo tên-version recipe
│   ├── deploy/
│   │   ├── images/      ← Output cuối cùng: file .img, kernel, dtb
│   │   └── rpm/         ← Các package đã build
│   └── sysroots/        ← Sysroot dùng để cross-compile
└── sstate-cache/        ← Shared state cache (nên để ngoài build/)
```

Thư mục `tmp/work/` có thể lên tới 50-80GB vì nó giữ lại toàn bộ build artifact của từng recipe. Bạn có thể xóa nó sau khi build xong nếu cần tiết kiệm disk.

### MACHINE vs DISTRO vs IMAGE — 3 khái niệm hay nhầm nhất

Đây là điểm mà hầu hết người mới đều bị nhầm lẫn, vì cả 3 đều "cấu hình" hệ thống nhưng ở các tầng khác nhau.

Hãy nghĩ theo chiều dọc: MACHINE ở tầng dưới cùng (phần cứng), DISTRO ở tầng giữa (OS policy), IMAGE ở tầng trên cùng (nội dung). Một IMAGE có thể deploy cho nhiều MACHINE khác nhau. Một DISTRO có thể chạy trên nhiều MACHINE khác nhau. Và với cùng một MACHINE + DISTRO, bạn có thể build nhiều IMAGE khác nhau (minimal, full, developer...).

Ví dụ cụ thể: `MACHINE = "raspberrypi5"` nói BitBake biết target là ARM Cortex-A76, dùng U-Boot cho bootloader, kernel phải có DT cho Pi 5. `DISTRO = "poky"` nói dùng glibc, systemd, và các default của Poky. `IMAGE = "core-image-minimal"` nói chỉ cần busybox, một shell, và các thứ tối thiểu để boot.

### Tại sao build lần đầu lâu nhưng lần sau nhanh hơn?

Lần đầu build một image hoàn chỉnh cho Pi 5 có thể mất 4-8 tiếng. Đây là điều bình thường và khiến nhiều người mới bỏ cuộc. Lý do là BitBake phải compile từ source tất cả mọi thứ: kernel, glibc, python3, gcc cross-compiler, v.v.

Tuy nhiên, BitBake có cơ chế **Shared State Cache (sstate-cache)**. Sau mỗi task thành công, BitBake lưu kết quả vào sstate-cache dưới dạng hash. Lần build sau, nếu recipe không thay đổi (hash giống nhau), BitBake lấy kết quả từ cache thay vì build lại. Vì vậy nếu bạn chỉ thay đổi recipe của ứng dụng mình, toàn bộ kernel và các thư viện hệ thống sẽ được lấy từ cache — build chỉ còn mất vài phút.

> **Lưu ý quan trọng:** Vì lý do này, bạn nên đặt `SSTATE_DIR` và `DL_DIR` ở ngoài thư mục `build/` — thậm chí ở ngoài cả project directory. Điều này cho phép bạn xóa và tạo lại build directory mà không mất cache, tiết kiệm hàng giờ build.

---

## PHẦN 3 — CHUẨN BỊ MÔI TRƯỜNG (Windows + WSL2/Debian)

### Tại sao Yocto không chạy native trên Windows?

Yocto phụ thuộc vào nhiều tính năng của hệ thống file Linux: symlink, hard link, case-sensitive filesystem, Unix permission (chmod/chown), và các đặc tính của ext4/tmpfs. Windows filesystem (NTFS) không hỗ trợ đủ những thứ này, và ngay cả Git for Windows cũng gặp vấn đề với symlink trong Yocto. Vì vậy, chạy Yocto trên Windows **không được hỗ trợ** và sẽ gặp lỗi rất khó debug.

WSL2 (Windows Subsystem for Linux 2) giải quyết vấn đề này: nó chạy một Linux kernel thật trong một VM nhẹ, với filesystem Linux thật (ext4). Yocto chạy bình thường trong WSL2 **với điều kiện** bạn làm việc trong filesystem của Linux (`/home/...`), không phải trong `/mnt/c/...` (filesystem Windows mount vào WSL). Nếu bạn để project trong `/mnt/c/Users/...`, build sẽ thất bại hoặc rất chậm.

> **Quy tắc vàng:** Toàn bộ Yocto project phải nằm trong filesystem Linux của WSL2, ví dụ `/home/yourname/yocto/`. Tuyệt đối không để trong `/mnt/c/` hay `/mnt/d/`.

### Cấu hình WSL2 để tăng RAM và CPU

Mặc định WSL2 dùng 50% RAM của máy host. Với Yocto cần tối thiểu 8GB RAM (khuyến nghị 16GB), bạn cần kiểm tra và có thể cần tăng giới hạn này. Tạo file `.wslconfig` trong thư mục home của Windows (`C:\Users\YourName\.wslconfig`):

```ini
[wsl2]
# Cấp toàn bộ RAM cho WSL2 nếu máy bạn có đủ
memory=16GB

# Cấp tất cả CPU cores
processors=8

# Tăng swap nếu RAM ít
swap=8GB

# Tắt tính năng page reporting để giảm overhead
pageReporting=false
```

Sau khi tạo file này, restart WSL2 bằng cách chạy `wsl --shutdown` trong PowerShell, rồi mở lại WSL2.

### Disk space cần bao nhiêu?

Đây là điểm khiến nhiều người bất ngờ. Một full build Yocto cho Pi 5 cần:

- Source downloads (DL_DIR): ~5-10GB
- Build artifacts (tmp/work/): ~40-80GB  
- sstate-cache: ~10-20GB
- Output images: ~1-2GB

Tổng cộng bạn cần **tối thiểu 100GB** cho WSL2 partition. Mặc định WSL2 sẽ tự expand virtual disk lên tới 256GB, nhưng bạn nên kiểm tra dung lượng ổ đĩa thật của máy trước khi bắt đầu.

### Cài các package cần thiết trên Debian

Mở WSL2 Debian và chạy các lệnh sau. Đây là danh sách đầy đủ theo yêu cầu của Yocto Scarthgap:

```bash
sudo apt update && sudo apt upgrade -y

sudo apt install -y \
    gawk \
    wget \
    git \
    diffstat \
    unzip \
    texinfo \
    gcc \
    build-essential \
    chrpath \
    socat \
    cpio \
    python3 \
    python3-pip \
    python3-pexpect \
    xz-utils \
    debianutils \
    iputils-ping \
    python3-git \
    python3-jinja2 \
    python3-subunit \
    zstd \
    liblz4-tool \
    file \
    locales \
    libacl1 \
    lz4
```

Sau đó cấu hình locale — bước này hay bị quên và gây lỗi kỳ lạ khi build:

```bash
sudo locale-gen en_US.UTF-8
sudo update-locale LANG=en_US.UTF-8
```

Đóng terminal và mở lại để locale có hiệu lực.

### Clone Poky (Yocto Scarthgap)

```bash
# Tạo thư mục làm việc trong filesystem Linux của WSL2
mkdir -p ~/yocto
cd ~/yocto

# Clone Poky branch scarthgap
git clone git://git.yoctoproject.org/poky.git --branch scarthgap
```

Sau khi clone, bạn sẽ có thư mục `poky/` chứa BitBake, meta layer cơ bản, và các script init.

---

## PHẦN 4 — CÁC LAYER CẦN THIẾT CHO RASPBERRY PI 5

### Tại sao cần nhiều layer?

Poky chỉ chứa những gì cần thiết cho một Linux system cơ bản. Để hỗ trợ Raspberry Pi 5 (BSP), có thêm các package Python phong phú, hay các tool networking, bạn cần thêm các layer bên ngoài vào.

### Các layer cần clone

Bắt đầu từ thư mục `~/yocto/`:

```bash
cd ~/yocto

# meta-openembedded: tập hợp nhiều layer quan trọng
# meta-oe: các package mở rộng (libusb, v4l-utils, v.v.)
# meta-python: python3 packages (python3-numpy, python3-opencv, v.v.)
# meta-networking: thư viện và tool mạng
git clone git://git.openembedded.org/meta-openembedded --branch scarthgap

# meta-raspberrypi: BSP layer cho toàn bộ dòng Raspberry Pi
# Đây là layer quan trọng nhất cho dự án của bạn
git clone git://git.yoctoproject.org/meta-raspberrypi --branch scarthgap
```

Sau khi clone xong, cấu trúc thư mục của bạn sẽ là:

```
~/yocto/
├── poky/
│   ├── meta/               ← Layer cơ bản (core)
│   ├── meta-poky/          ← Poky distro config
│   └── meta-yocto-bsp/    ← BSP mẫu (không dùng cho Pi)
├── meta-openembedded/
│   ├── meta-oe/
│   ├── meta-python/
│   ├── meta-networking/
│   └── ... (nhiều sublayer khác)
└── meta-raspberrypi/       ← BSP cho Raspberry Pi
```

### BSP layer là gì?

BSP viết tắt của Board Support Package. Đây là layer chứa mọi thứ liên quan đến phần cứng cụ thể: kernel patches cho Pi 5, Device Tree files (`.dtb`), firmware cho VideoCore GPU, bootloader config (config.txt), và các recipe cho các driver đặc thù của Pi.

Không có `meta-raspberrypi`, BitBake không biết gì về Pi 5 — nó sẽ không tìm thấy `MACHINE = "raspberrypi5"` và báo lỗi.

---

## PHẦN 5 — CẤU HÌNH BUILD (local.conf và bblayers.conf)

### Khởi tạo build environment

Đây là bước phải làm **mỗi lần** bạn mở terminal mới:

```bash
cd ~/yocto
source poky/oe-init-build-env build-rpi5
```

Script này làm hai việc: set các biến môi trường cần thiết cho BitBake, và (lần đầu tiên) tạo thư mục `build-rpi5/` với file `conf/local.conf` và `conf/bblayers.conf` mặc định. Sau khi chạy, terminal sẽ tự `cd` vào thư mục `build-rpi5/`.

> **Tại sao đặt tên `build-rpi5`?** Bạn có thể có nhiều build directory cho nhiều target khác nhau. Đặt tên rõ ràng giúp tránh nhầm lẫn.

### Cấu hình bblayers.conf

File này liệt kê các layer BitBake sẽ sử dụng. Mở file `conf/bblayers.conf` và chỉnh sửa để thêm các layer bạn vừa clone:

```bash
# Nội dung conf/bblayers.conf sau khi chỉnh sửa
BBLAYERS ?= " \
  /home/yourname/yocto/poky/meta \
  /home/yourname/yocto/poky/meta-poky \
  /home/yourname/yocto/poky/meta-yocto-bsp \
  /home/yourname/yocto/meta-openembedded/meta-oe \
  /home/yourname/yocto/meta-openembedded/meta-python \
  /home/yourname/yocto/meta-openembedded/meta-networking \
  /home/yourname/yocto/meta-raspberrypi \
  "
```

Thay `yourname` bằng username thật của bạn. Sau đó kiểm tra các layer đã được nhận diện đúng chưa:

```bash
bitbake-layers show-layers
```

Nếu output hiển thị danh sách các layer với priority và path đúng, bạn đã cấu hình đúng.

### Cấu hình local.conf — Đây là file quan trọng nhất

Mở `conf/local.conf`. File này dài và có nhiều comment. Dưới đây là các biến quan trọng bạn cần chỉnh:

```bash
# ── Target hardware ────────────────────────────────────────
# Đây là biến quan trọng nhất — phải set đúng tên machine
MACHINE = "raspberrypi5"

# ── Distro ────────────────────────────────────────────────
# Dùng Poky làm distribution mặc định
DISTRO = "poky"

# ── Package format ────────────────────────────────────────
# rpm là mặc định và hoạt động tốt cho embedded
PACKAGE_CLASSES = "package_rpm"

# ── Performance: số thread song song ──────────────────────
# Đặt bằng số CPU core của máy bạn (kiểm tra bằng: nproc)
BB_NUMBER_THREADS = "8"
# Đặt bằng số core * 1.5 hoặc bằng BB_NUMBER_THREADS
PARALLEL_MAKE = "-j 8"

# ── Cache directories — ĐẶT NGOÀI BUILD DIR ───────────────
# DL_DIR: nơi lưu source code đã download
# Đặt ngoài build dir để tái dùng giữa các project
DL_DIR = "/home/yourname/yocto/downloads"

# SSTATE_DIR: shared state cache — quan trọng cho tốc độ
# Đặt ngoài build dir để không mất cache khi xóa build dir
SSTATE_DIR = "/home/yourname/yocto/sstate-cache"

# ── Output image format ───────────────────────────────────
# rpi-sdimg: file image có thể flash thẳng vào SD card
# wic.bz2: định dạng nén, nhỏ hơn nhưng cần giải nén trước khi flash
IMAGE_FSTYPES = "rpi-sdimg"

# ── Bật SSH để có thể remote vào Pi sau khi boot ──────────
EXTRA_IMAGE_FEATURES += "ssh-server-openssh"

# ── Thêm các package cơ bản vào image ────────────────────
# Thêm dần khi cần, không thêm tất cả ngay từ đầu
IMAGE_INSTALL:append = " \
    python3 \
    python3-pip \
    git \
    nano \
    htop \
"

# ── Cho phép root login (tiện cho development) ────────────
# Xóa dòng này khi làm sản phẩm thật
EXTRA_IMAGE_FEATURES += "debug-tweaks"

# ── Specific Raspberry Pi settings ────────────────────────
# Enable UART để có serial console (debug khi không có màn hình)
ENABLE_UART = "1"

# Enable SPI (cần cho RFID MFRC522)
ENABLE_SPI_BUS = "1"

# Enable I2C nếu cần
ENABLE_I2C = "1"

# GPU memory allocation (MB) — cần cho camera
GPU_MEM = "128"
```

> **Tại sao tách DL_DIR và SSTATE_DIR ra ngoài?** Giả sử bạn xóa thư mục `build-rpi5/` để build lại từ đầu (để debug một vấn đề kỳ lạ chẳng hạn). Nếu cache nằm trong build dir, bạn mất tất cả và phải build lại từ đầu hàng giờ. Nếu cache nằm ngoài, BitBake vẫn tìm thấy và tái dùng — tiết kiệm rất nhiều thời gian.

---

## PHẦN 6 — RECIPE LÀ GÌ VÀ CÁCH VIẾT RECIPE

### Anatomy của một file recipe (.bb)

Một recipe là file text với cú pháp của BitBake. Hãy xem ví dụ recipe đơn giản và giải thích từng phần:

```bash
# Ví dụ: hello-world_1.0.bb

# Mô tả ngắn về package
DESCRIPTION = "Hello World application"

# License của source code — bắt buộc phải khai báo
# Nếu là code của bạn, dùng "MIT" hoặc "CLOSED"
LICENSE = "MIT"

# Checksum của file license — BitBake yêu cầu để verify
LIC_FILES_CHKSUM = "file://${COMMON_LICENSE_DIR}/MIT;md5=0835ade698e0bcf8506ecda2f7b4f302"

# Lấy source code từ đâu
# file:// = lấy từ thư mục files/ cạnh recipe
# git:// = clone từ git repo
# https:// = download file
SRC_URI = "file://hello.py"

# Thư mục làm việc sau khi unpack
S = "${WORKDIR}"

# DEPENDS: package cần có lúc BUILD TIME (compile)
# RDEPENDS: package cần có lúc RUNTIME (trên target)
RDEPENDS:${PN} = "python3"

# do_install: copy file vào đúng chỗ trong staging area
# D = destination (staging rootfs)
# bindir = /usr/bin
do_install() {
    install -d ${D}${bindir}
    install -m 0755 ${S}/hello.py ${D}${bindir}/hello
}
```

### DEPENDS vs RDEPENDS — điểm hay nhầm nhất

`DEPENDS` khai báo dependency tại **build time** — những thứ cần có để compile code của bạn. Ví dụ nếu bạn compile một C program dùng libusb, bạn cần `DEPENDS = "libusb1"` để BitBake biết phải build libusb trước, và linker mới tìm thấy header/library.

`RDEPENDS:${PN}` khai báo dependency tại **runtime** — những thứ cần có trên thiết bị để chương trình chạy được. Ví dụ một Python script không cần compile, nhưng cần `python3` có mặt trên Pi để chạy, nên khai báo `RDEPENDS:${PN} = "python3"`.

`${PN}` là biến tự động chứa tên package (Package Name), được lấy từ tên file recipe.

### .bbappend — Override recipe mà không sửa file gốc

`.bbappend` là công cụ rất mạnh của Yocto. Giả sử bạn muốn thay đổi cách build `python3` — bạn không sửa trực tiếp recipe `python3_3.12.bb` trong Poky (vì sẽ mất khi update), mà tạo file `python3_%.bbappend` trong layer của bạn.

Dấu `%` nghĩa là "match mọi version". BitBake sẽ tự động merge nội dung `.bbappend` vào recipe gốc.

```bash
# Ví dụ: python3_%.bbappend trong layer của bạn
# Thêm một patch tùy chỉnh vào python3
SRC_URI += "file://my-custom-patch.patch"

# Thêm package vào RDEPENDS
RDEPENDS:${PN} += "python3-numpy"
```

### Ví dụ thực tế: Recipe cho một Python application với systemd service

Đây là ví dụ gần giống với dự án của bạn — một Python app chạy như systemd service:

```bash
# attendance-system_1.0.bb

DESCRIPTION = "Bus attendance system using face recognition and RFID"
LICENSE = "CLOSED"

# Source từ thư mục files/ cạnh recipe
SRC_URI = " \
    file://attendance-system.tar.gz \
    file://attendance-system.service \
"

S = "${WORKDIR}/attendance-system"

# Inherit systemd class để tích hợp với systemd
inherit systemd

# Tên service file
SYSTEMD_SERVICE:${PN} = "attendance-system.service"

# Auto-enable service khi boot
SYSTEMD_AUTO_ENABLE = "enable"

# Runtime dependencies
RDEPENDS:${PN} = " \
    python3 \
    python3-numpy \
    python3-opencv \
    python3-pygame \
    python3-paho-mqtt \
    python3-serial \
    python3-sqlite3 \
"

do_install() {
    # Cài app vào /opt/attendance-system/
    install -d ${D}/opt/attendance-system
    cp -r ${S}/* ${D}/opt/attendance-system/

    # Cài systemd service file
    install -d ${D}${systemd_system_unitdir}
    install -m 0644 ${WORKDIR}/attendance-system.service \
        ${D}${systemd_system_unitdir}/
}

# Khai báo file nào thuộc package nào
FILES:${PN} = " \
    /opt/attendance-system \
    ${systemd_system_unitdir}/attendance-system.service \
"
```

---

## PHẦN 7 — BUILD IMAGE THỰC TẾ STEP BY STEP

### Bước 1: Source environment (bắt buộc mỗi lần mở terminal mới)

```bash
cd ~/yocto
source poky/oe-init-build-env build-rpi5
# Terminal tự cd vào build-rpi5/
```

### Bước 2: Kiểm tra cấu hình trước khi build

```bash
# Kiểm tra layers
bitbake-layers show-layers

# Kiểm tra giá trị một biến (ví dụ MACHINE)
bitbake -e | grep "^MACHINE="

# Kiểm tra recipe nào sẽ được build cho một image
bitbake -g core-image-minimal
# Tạo ra file task-depends.dot — có thể visualize bằng graphviz
```

### Bước 3: Build image đầu tiên

Lần đầu, hãy build `core-image-minimal` — image nhỏ nhất để test xem cấu hình đúng không trước khi build image đầy đủ:

```bash
bitbake core-image-minimal
```

Đây là lúc bạn có thể đi uống cà phê. Lần đầu build mất từ 4-8 tiếng tùy sức mạnh máy. BitBake sẽ hiển thị progress như này:

```
Loading cache: 100% |########################################| Time: 0:00:02
Loaded 4524 entries from dependency cache.
NOTE: Resolving any missing task queue dependencies

Build Configuration:
BB_VERSION           = "2.6.0"
BUILD_SYS            = "x86_64-linux"
NATIVELSBSTRING      = "universal"
TARGET_SYS           = "aarch64-poky-linux"
MACHINE              = "raspberrypi5"
DISTRO               = "poky"
...

Initialising tasks: 100% |###################################| Time: 0:00:08
Sstate summary: Wanted 823 Local 0 Mirrors 0 Missed 823 Current 0 (0% match, 0% complete)
NOTE: Executing Tasks
NOTE: Tasks Summary: Attempted 3241 tasks of which 0 didn't need to be rerun...
```

Dòng `Sstate summary` cho biết bao nhiêu task được lấy từ cache. Lần đầu sẽ là 0 (tất cả phải build). Lần sau sẽ là gần 100%.

### Bước 4: Tìm output image

```bash
ls -lh tmp/deploy/images/raspberrypi5/
```

Bạn sẽ thấy nhiều file, quan trọng nhất là:
- `core-image-minimal-raspberrypi5.rpi-sdimg` — file image có thể flash thẳng
- `Image` — Linux kernel
- `bcm2712-rpi-5-b.dtb` — Device Tree Blob cho Pi 5

### Bước 5: Flash lên SD card

Từ WSL2, bạn có thể flash bằng `dd`. Nhưng cần cẩn thận xác định đúng device:

```bash
# Từ PowerShell Windows, xem SD card là ổ gì (ví dụ D:)
# Sau đó trong WSL2:
# SD card thường xuất hiện là /dev/sdX khi cắm vào WSL2

# Tìm SD card
lsblk

# Flash (THAY sdX bằng device thật, ví dụ sdb — KHÔNG ĐƯỢC NHẦM)
sudo dd \
    if=tmp/deploy/images/raspberrypi5/core-image-minimal-raspberrypi5.rpi-sdimg \
    of=/dev/sdX \
    bs=4M \
    status=progress \
    conv=fsync
```

> **Cảnh báo:** Lệnh `dd` sẽ xóa sạch thiết bị đích mà không hỏi lại. Hãy chắc chắn `of=/dev/sdX` là đúng SD card, không phải ổ cứng của máy bạn. Kiểm tra kỹ bằng `lsblk` trước khi chạy.

Cách an toàn hơn: copy file `.rpi-sdimg` sang Windows rồi dùng **Balena Etcher** để flash — nó có giao diện đồ họa và tự động chọn đúng thiết bị.

```bash
# Copy image sang Windows để dùng Etcher
cp tmp/deploy/images/raspberrypi5/core-image-minimal-raspberrypi5.rpi-sdimg \
    /mnt/c/Users/YourName/Desktop/
```

---

## PHẦN 8 — CUSTOM LAYER VÀ CUSTOM IMAGE

### Tạo custom layer cho dự án của bạn

Không bao giờ đặt recipe của dự án vào trong `poky/` hay `meta-raspberrypi/`. Luôn tạo layer riêng:

```bash
cd ~/yocto

# BitBake có tool tạo layer tự động
bitbake-layers create-layer meta-busattendance

# Hoặc tạo tay:
mkdir -p meta-busattendance/conf
mkdir -p meta-busattendance/recipes-attendance/attendance-system/files
```

File `meta-busattendance/conf/layer.conf` là bắt buộc, BitBake dùng nó để nhận diện layer:

```bash
# meta-busattendance/conf/layer.conf

# Đường dẫn tới layer (tự động)
BBPATH .= ":${LAYERDIR}"

# Tìm tất cả recipe trong layer này
BBFILES += "${LAYERDIR}/recipes-*/*/*.bb \
             ${LAYERDIR}/recipes-*/*/*.bbappend"

# Priority: số cao hơn sẽ override layer có priority thấp hơn
# meta-raspberrypi dùng 9, layer của bạn dùng 10 để có thể override nếu cần
BBFILE_COLLECTIONS += "busattendance"
BBFILE_PATTERN_busattendance = "^${LAYERDIR}/"
BBFILE_PRIORITY_busattendance = "10"

# Khai báo compatible với Yocto version nào
LAYERSERIES_COMPAT_busattendance = "scarthgap"
```

Sau đó thêm layer vào `bblayers.conf`:

```bash
# Thêm vào BBLAYERS trong conf/bblayers.conf
/home/yourname/yocto/meta-busattendance \
```

### Tạo custom image recipe

Thay vì dùng `core-image-minimal` và nhồi nhét mọi thứ vào `local.conf`, hãy tạo image recipe riêng — đây là cách chuyên nghiệp hơn:

```bash
# meta-busattendance/recipes-core/images/rpi5-attendance-image.bb

# Kế thừa từ core-image để có base functionality
inherit core-image

# Mô tả image
IMAGE_FEATURES += " \
    ssh-server-openssh \
    debug-tweaks \
"

# Danh sách package đầy đủ cho hệ thống điểm danh
IMAGE_INSTALL += " \
    packagegroup-core-boot \
    packagegroup-base \
    python3 \
    python3-numpy \
    python3-pillow \
    python3-paho-mqtt \
    python3-pyserial \
    python3-sqlite3 \
    opencv \
    python3-opencv \
    mosquitto \
    attendance-system \
"
```

Build image tùy chỉnh của bạn:

```bash
bitbake rpi5-attendance-image
```

### DISTRO_FEATURES và IMAGE_FEATURES

`DISTRO_FEATURES` kiểm soát các tính năng ở mức toàn system được compile vào tất cả các package. Ví dụ nếu bạn set `DISTRO_FEATURES += "bluetooth"`, thì các package như BlueZ sẽ được compile với Bluetooth support.

`IMAGE_FEATURES` kiểm soát những gì được đưa vào image cụ thể — ví dụ `ssh-server-openssh` thêm OpenSSH server, `package-management` thêm package manager vào image để có thể cài thêm package sau khi deploy.

---

## PHẦN 9 — DEBUG VÀ TIPS

### Các lỗi phổ biến khi mới dùng Yocto trên WSL2

**Lỗi: "Please use a different source directory"**
Nguyên nhân: Bạn đang chạy Yocto trong `/mnt/c/...` (filesystem Windows). Di chuyển toàn bộ project vào `/home/...`.

**Lỗi: "Error: not found: MACHINE"**
Nguyên nhân: `meta-raspberrypi` chưa được thêm vào `bblayers.conf`, hoặc thêm sai đường dẫn. Kiểm tra lại bằng `bitbake-layers show-layers`.

**Lỗi: locale error khi build**
```bash
sudo locale-gen en_US.UTF-8
export LC_ALL=en_US.UTF-8
export LANG=en_US.UTF-8
```

**Lỗi: "do_fetch" thất bại**
Thường do mất kết nối mạng trong lúc download, hoặc URL source code không còn tồn tại (recipe cũ). Chạy lại là được trong hầu hết trường hợp. Nếu vẫn lỗi, kiểm tra mirror URL trong recipe.

### Các lệnh debug hữu ích

```bash
# Xem giá trị một biến đã được resolve (rất hữu ích để debug)
bitbake -e core-image-minimal | grep "^IMAGE_INSTALL"

# Mở devshell trong môi trường build của một recipe
# (có thể chạy tay từng lệnh configure/compile để debug)
bitbake -c devshell python3

# Chạy lại một task cụ thể (bỏ qua cache)
bitbake -c compile -f myrecipe

# Liệt kê tất cả task của một recipe
bitbake -c listtasks myrecipe

# Xem log của một task thất bại
# Log nằm ở: tmp/work/.../temp/log.do_TASKNAME
cat tmp/work/cortexa76-poky-linux/myrecipe/1.0/temp/log.do_compile

# Kiểm tra recipe nào cung cấp một package
bitbake -s | grep python3

# Build chỉ một recipe (không build cả image)
bitbake python3
```

### Khi nào nên xóa sstate-cache?

Sstate-cache rất quý — đừng xóa nó trừ khi thực sự cần thiết. Các trường hợp nên xóa:

Xóa cache của một recipe cụ thể (an toàn hơn): khi bạn thay đổi recipe nhưng BitBake vẫn dùng cache cũ.
```bash
bitbake -c cleansstate myrecipe
```

Xóa toàn bộ tmp/ (không xóa sstate): khi build bị lỗi kỳ lạ không giải thích được.
```bash
rm -rf tmp/
# Lần build sau sẽ lấy lại từ sstate-cache — nhanh hơn build từ đầu
```

Xóa toàn bộ sstate (nuclear option): chỉ khi upgrade Yocto version hoặc thay đổi MACHINE.
```bash
rm -rf sstate-cache/
# Lần build sau sẽ mất rất nhiều thời gian
```

### Tips tăng tốc trên WSL2

Đặt `TMPDIR` vào tmpfs (RAM disk) nếu bạn có đủ RAM — thao tác I/O sẽ nhanh hơn đáng kể:

```bash
# Trong local.conf — chỉ nên dùng nếu bạn có >= 32GB RAM
# TMPDIR = "/tmp/yocto-build"
```

Dùng `BB_NUMBER_THREADS` và `PARALLEL_MAKE` hợp lý. Đặt quá cao (nhiều hơn số core thật) sẽ không giúp ích và có thể làm chậm do context switching:

```bash
# Trong local.conf
# Kiểm tra số core: nproc
BB_NUMBER_THREADS = "$(nproc)"
PARALLEL_MAKE = "-j $(nproc)"
```

---

## TỔNG KẾT — THỨ TỰ THỰC HIỆN

Để build lần đầu thành công, làm theo đúng thứ tự này:

1. Cấu hình WSL2 (`.wslconfig`) — đảm bảo đủ RAM và CPU
2. Cài đặt tất cả dependencies trên Debian
3. Clone Poky (scarthgap), meta-openembedded, meta-raspberrypi vào `~/yocto/`
4. `source poky/oe-init-build-env build-rpi5`
5. Chỉnh `conf/bblayers.conf` — thêm đủ 6-7 layer
6. Chỉnh `conf/local.conf` — đặt MACHINE, DL_DIR, SSTATE_DIR, threads
7. `bitbake core-image-minimal` — build image thử nghiệm
8. Flash và kiểm tra Pi 5 boot được
9. Tạo `meta-busattendance` layer riêng
10. Viết recipe cho ứng dụng và tạo custom image
11. `bitbake rpi5-attendance-image` — build image cuối cùng

Mỗi bước đều có thể gặp lỗi — đó là bình thường với Yocto. Đọc log kỹ, tra cứu error message, và hỏi nếu bị stuck. Khi đã build thành công lần đầu, các lần sau sẽ nhanh và ít lỗi hơn rất nhiều nhờ sstate-cache.

---

*Tài liệu này áp dụng cho Yocto Project Scarthgap (5.0 LTS), meta-raspberrypi scarthgap branch, host Debian trên WSL2.*
