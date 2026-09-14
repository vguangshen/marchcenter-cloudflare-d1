import { OfficialTicketError } from './errors.js';

const IP = [58,50,42,34,26,18,10,2,60,52,44,36,28,20,12,4,62,54,46,38,30,22,14,6,64,56,48,40,32,24,16,8,57,49,41,33,25,17,9,1,59,51,43,35,27,19,11,3,61,53,45,37,29,21,13,5,63,55,47,39,31,23,15,7];
const FP = [40,8,48,16,56,24,64,32,39,7,47,15,55,23,63,31,38,6,46,14,54,22,62,30,37,5,45,13,53,21,61,29,36,4,44,12,52,20,60,28,35,3,43,11,51,19,59,27,34,2,42,10,50,18,58,26,33,1,41,9,49,17,57,25];
const E = [32,1,2,3,4,5,4,5,6,7,8,9,8,9,10,11,12,13,12,13,14,15,16,17,16,17,18,19,20,21,20,21,22,23,24,25,24,25,26,27,28,29,28,29,30,31,32,1];
const P = [16,7,20,21,29,12,28,17,1,15,23,26,5,18,31,10,2,8,24,14,32,27,3,9,19,13,30,6,22,11,4,25];
const PC1 = [57,49,41,33,25,17,9,1,58,50,42,34,26,18,10,2,59,51,43,35,27,19,11,3,60,52,44,36,63,55,47,39,31,23,15,7,62,54,46,38,30,22,14,6,61,53,45,37,29,21,13,5,28,20,12,4];
const PC2 = [14,17,11,24,1,5,3,28,15,6,21,10,23,19,12,4,26,8,16,7,27,20,13,2,41,52,31,37,47,55,30,40,51,45,33,48,44,49,39,56,34,53,46,42,50,36,29,32];
const SHIFTS = [1,1,2,2,2,2,2,2,1,2,2,2,2,2,2,1];
const SBOXES = [
    [14,4,13,1,2,15,11,8,3,10,6,12,5,9,0,7,0,15,7,4,14,2,13,1,10,6,12,11,9,5,3,8,4,1,14,8,13,6,2,11,15,12,9,7,3,10,5,0,15,12,8,2,4,9,1,7,5,11,3,14,10,0,6,13],
    [15,1,8,14,6,11,3,4,9,7,2,13,12,0,5,10,3,13,4,7,15,2,8,14,12,0,1,10,6,9,11,5,0,14,7,11,10,4,13,1,5,8,12,6,9,3,2,15,13,8,10,1,3,15,4,2,11,6,7,12,0,5,14,9],
    [10,0,9,14,6,3,15,5,1,13,12,7,11,4,2,8,13,7,0,9,3,4,6,10,2,8,5,14,12,11,15,1,13,6,4,9,8,15,3,0,11,1,2,12,5,10,14,7,1,10,13,0,6,9,8,7,4,15,14,3,11,5,2,12],
    [7,13,14,3,0,6,9,10,1,2,8,5,11,12,4,15,13,8,11,5,6,15,0,3,4,7,2,12,1,10,14,9,10,6,9,0,12,11,7,13,15,1,3,14,5,2,8,4,3,15,0,6,10,1,13,8,9,4,5,11,12,7,2,14],
    [2,12,4,1,7,10,11,6,8,5,3,15,13,0,14,9,14,11,2,12,4,7,13,1,5,0,15,10,3,9,8,6,4,2,1,11,10,13,7,8,15,9,12,5,6,3,0,14,11,8,12,7,1,14,2,13,6,15,0,9,10,4,5,3],
    [12,1,10,15,9,2,6,8,0,13,3,4,14,7,5,11,10,15,4,2,7,12,9,5,6,1,13,14,0,11,3,8,9,14,15,5,2,8,12,3,7,0,4,10,1,13,11,6,4,3,2,12,9,5,15,10,11,14,1,7,6,0,8,13],
    [4,11,2,14,15,0,8,13,3,12,9,7,5,10,6,1,13,0,11,7,4,9,1,10,14,3,5,12,2,15,8,6,1,4,11,13,12,3,7,14,10,15,6,8,0,5,9,2,6,11,13,8,1,4,10,7,9,5,0,15,14,2,3,12],
    [13,2,8,4,6,15,11,1,10,9,3,14,5,0,12,7,1,15,13,8,10,3,7,4,12,5,6,11,0,14,9,2,7,11,4,1,9,12,14,2,0,6,10,13,15,3,5,8,2,1,14,7,4,10,8,13,15,12,9,0,3,5,6,11]
];

function permute(input, inputBits, table) {
    let output = 0n;
    for (const position of table) {
        output = (output << 1n) | ((input >> BigInt(inputBits - position)) & 1n);
    }
    return output;
}

function bytesToBigInt(bytes) {
    let value = 0n;
    for (const byte of bytes) value = (value << 8n) | BigInt(byte);
    return value;
}

function bigIntToBytes(value, length) {
    const output = new Uint8Array(length);
    for (let index = length - 1; index >= 0; index -= 1) {
        output[index] = Number(value & 0xffn);
        value >>= 8n;
    }
    return output;
}

function createSubkeys(keyBytes) {
    const selected = permute(bytesToBigInt(keyBytes), 64, PC1);
    let left = Number((selected >> 28n) & 0xfffffffn);
    let right = Number(selected & 0xfffffffn);
    return SHIFTS.map(shift => {
        left = ((left << shift) | (left >>> (28 - shift))) & 0x0fffffff;
        right = ((right << shift) | (right >>> (28 - shift))) & 0x0fffffff;
        return permute((BigInt(left) << 28n) | BigInt(right), 56, PC2);
    });
}

function feistel(right, subkey) {
    const mixed = permute(BigInt(right >>> 0), 32, E) ^ subkey;
    let substituted = 0;
    for (let box = 0; box < 8; box += 1) {
        const chunk = Number((mixed >> BigInt((7 - box) * 6)) & 0x3fn);
        const row = ((chunk & 0x20) >> 4) | (chunk & 1);
        const column = (chunk >> 1) & 0x0f;
        substituted = (substituted << 4) | SBOXES[box][row * 16 + column];
    }
    return Number(permute(BigInt(substituted >>> 0), 32, P)) >>> 0;
}

function encryptBlock(block, subkeys) {
    const initial = permute(bytesToBigInt(block), 64, IP);
    let left = Number((initial >> 32n) & 0xffffffffn) >>> 0;
    let right = Number(initial & 0xffffffffn) >>> 0;
    for (const subkey of subkeys) {
        const next = (left ^ feistel(right, subkey)) >>> 0;
        left = right;
        right = next;
    }
    return bigIntToBytes(permute((BigInt(right) << 32n) | BigInt(left), 64, FP), 8);
}

function md5Hex(bytes) {
    const originalLength = bytes.length;
    const paddedLength = Math.ceil((originalLength + 9) / 64) * 64;
    const padded = new Uint8Array(paddedLength);
    padded.set(bytes);
    padded[originalLength] = 0x80;
    const bitLength = BigInt(originalLength) * 8n;
    for (let index = 0; index < 8; index += 1) {
        padded[paddedLength - 8 + index] = Number((bitLength >> BigInt(index * 8)) & 0xffn);
    }

    let a0 = 0x67452301;
    let b0 = 0xefcdab89;
    let c0 = 0x98badcfe;
    let d0 = 0x10325476;
    const shifts = [7,12,17,22,7,12,17,22,7,12,17,22,7,12,17,22,5,9,14,20,5,9,14,20,5,9,14,20,5,9,14,20,4,11,16,23,4,11,16,23,4,11,16,23,4,11,16,23,6,10,15,21,6,10,15,21,6,10,15,21,6,10,15,21];
    const constants = Array.from({ length: 64 }, (_, index) => Math.floor(Math.abs(Math.sin(index + 1)) * 0x100000000) >>> 0);

    for (let offset = 0; offset < padded.length; offset += 64) {
        const words = new Uint32Array(16);
        for (let index = 0; index < 16; index += 1) {
            const start = offset + index * 4;
            words[index] = (padded[start] | (padded[start + 1] << 8) | (padded[start + 2] << 16) | (padded[start + 3] << 24)) >>> 0;
        }
        let a = a0;
        let b = b0;
        let c = c0;
        let d = d0;
        for (let index = 0; index < 64; index += 1) {
            let f;
            let wordIndex;
            if (index < 16) {
                f = (b & c) | (~b & d);
                wordIndex = index;
            } else if (index < 32) {
                f = (d & b) | (~d & c);
                wordIndex = (5 * index + 1) % 16;
            } else if (index < 48) {
                f = b ^ c ^ d;
                wordIndex = (3 * index + 5) % 16;
            } else {
                f = c ^ (b | ~d);
                wordIndex = (7 * index) % 16;
            }
            const sum = (a + f + constants[index] + words[wordIndex]) >>> 0;
            const rotated = ((sum << shifts[index]) | (sum >>> (32 - shifts[index]))) >>> 0;
            [a, d, c, b] = [d, c, b, (b + rotated) >>> 0];
        }
        a0 = (a0 + a) >>> 0;
        b0 = (b0 + b) >>> 0;
        c0 = (c0 + c) >>> 0;
        d0 = (d0 + d) >>> 0;
    }

    return [a0, b0, c0, d0].map(word => [0,8,16,24]
        .map(shift => ((word >>> shift) & 0xff).toString(16).padStart(2, '0')).join('')).join('');
}

function deriveKey(ticketType) {
    const text = String(ticketType ?? '');
    if (!text) throw new OfficialTicketError('票据类型不能为空');
    const keyText = md5Hex(new TextEncoder().encode(text)).slice(0, 8).toUpperCase();
    return new TextEncoder().encode(keyText);
}

function desCbcEncrypt(plaintext, keyBytes) {
    const source = new TextEncoder().encode(plaintext);
    const padding = 8 - (source.length % 8);
    const padded = new Uint8Array(source.length + padding);
    padded.set(source);
    padded.fill(padding, source.length);
    const subkeys = createSubkeys(keyBytes);
    const output = new Uint8Array(padded.length);
    let previous = keyBytes;
    for (let offset = 0; offset < padded.length; offset += 8) {
        const block = padded.slice(offset, offset + 8);
        for (let index = 0; index < 8; index += 1) block[index] ^= previous[index];
        const encrypted = encryptBlock(block, subkeys);
        output.set(encrypted, offset);
        previous = encrypted;
    }
    return Array.from(output, byte => byte.toString(16).padStart(2, '0')).join('').toUpperCase();
}

export function buildStudentBaseClassPlaintext(student = {}) {
    return JSON.stringify({
        studentID: String(student.studentID ?? ''),
        password: String(student.password ?? ''),
        nickName: String(student.nickName ?? '')
    });
}

export function buildCiphertext(student, ticketType = 'itmc') {
    try {
        return desCbcEncrypt(buildStudentBaseClassPlaintext(student), deriveKey(ticketType));
    } catch (cause) {
        if (cause instanceof OfficialTicketError) throw cause;
        throw new OfficialTicketError('登录票据生成失败', { cause });
    }
}

