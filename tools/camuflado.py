"""Gera uma estampa camuflada woodland original, sem emenda (o tile repete perfeitamente).
Cada camada é um campo de ruído periódico suavizado no domínio da frequência e cortado num limiar."""
import sys
import numpy as np
from PIL import Image

SEED = int(sys.argv[1]) if len(sys.argv) > 1 else 7
OUT = sys.argv[2] if len(sys.argv) > 2 else '.'
N = 1536          # resolução de trabalho (o tile final sai com metade, suavizado)
rng = np.random.default_rng(SEED)

ky = np.fft.fftfreq(N) * N
kx = np.fft.fftfreq(N) * N
K = np.sqrt(ky[:, None] ** 2 + kx[None, :] ** 2)

def field(k0, bumps, kb):
    noise = rng.standard_normal((N, N))
    spec = np.fft.fft2(noise)
    filt = np.exp(-(K / k0) ** 2) + bumps * np.exp(-(K / kb) ** 2)
    filt[0, 0] = 0
    f = np.real(np.fft.ifft2(spec * filt))
    return (f - f.mean()) / f.std()

def blur(mask, sigma):
    filt = np.exp(-0.5 * (K * sigma / N * 2 * np.pi) ** 2)
    return np.real(np.fft.ifft2(np.fft.fft2(mask) * filt))

def layer(coverage, k0=4.2, bumps=0.10, kb=9):
    f = field(k0, bumps, kb)
    m = (f > np.quantile(f, 1 - coverage)).astype(float)
    # arredonda cantos e some com pontinhos soltos
    m = blur(m, 16) > 0.5
    return m

# ordem de pintura: base cáqui, depois marrom, oliva e o escuro por cima
brown = layer(0.42)
olive = layer(0.38)
dark = layer(0.27, k0=4.0)

idx = np.zeros((N, N), np.uint8)   # 0 cáqui
idx[brown] = 1
idx[olive] = 2
idx[dark] = 3
# limpa pontinhos e frestas: filtro de moda com borda "dando a volta" (o tile continua sem emenda)
from PIL import ImageFilter
P = 24
padded = np.pad(idx, P, mode='wrap')
clean = np.asarray(Image.fromarray(padded, 'L').filter(ImageFilter.ModeFilter(13)))[P:-P, P:-P]
idx = np.ascontiguousarray(clean)
cov = [round(float((idx == i).mean()) * 100, 1) for i in range(4)]
print('cobertura cáqui/marrom/oliva/escuro %:', cov)

PALETTE = np.array([
    [0xa2, 0x9a, 0x72],  # cáqui
    [0x6a, 0x5a, 0x42],  # marrom
    [0x6e, 0x76, 0x4e],  # oliva
    [0x46, 0x46, 0x3a],  # verde escuro
], np.float32)

rgb = PALETTE[idx]
# reduz para metade fazendo média 2x2 (bordas suaves) mantendo o tile periódico
half = rgb.reshape(N // 2, 2, N // 2, 2, 3).mean(axis=(1, 3))
img = Image.fromarray(np.clip(half + 0.5, 0, 255).astype(np.uint8), 'RGB')
img.save(f'{OUT}/camo-{SEED}.png')

# versão monocromática: branco com transparência por camada (para usar bem fraquinho sobre o preto)
ALPHA = np.array([0.0, 0.42, 0.68, 1.0], np.float32)
a = ALPHA[idx].reshape(N // 2, 2, N // 2, 2).mean(axis=(1, 3))
mono = np.zeros((N // 2, N // 2, 4), np.uint8)
mono[..., :3] = 255
mono[..., 3] = np.clip(a * 255 + 0.5, 0, 255).astype(np.uint8)
Image.fromarray(mono, 'RGBA').save(f'{OUT}/camo-mono-{SEED}.png')
