export const VENDOR_AES_JS_JS = `/*! MIT License. Copyright 2015-2018 Richard Moore <me@ricmoo.com>. See LICENSE.txt. */
(function(root) {
    "use strict";

    function checkInt(value) {
        return (parseInt(value) === value);
    }

    function checkInts(arrayish) {
        if (!checkInt(arrayish.length)) { return false; }

        for (var i = 0; i < arrayish.length; i++) {
            if (!checkInt(arrayish[i]) || arrayish[i] < 0 || arrayish[i] > 255) {
                return false;
            }
        }

        return true;
    }

    function coerceArray(arg, copy) {

        // ArrayBuffer view
        if (arg.buffer && arg.name === 'Uint8Array') {

            if (copy) {
                if (arg.slice) {
                    arg = arg.slice();
                } else {
                    arg = Array.prototype.slice.call(arg);
                }
            }

            return arg;
        }

        // It's an array; check it is a valid representation of a byte
        if (Array.isArray(arg)) {
            if (!checkInts(arg)) {
                throw new Error('Array contains invalid value: ' + arg);
            }

            return new Uint8Array(arg);
        }

        // Something else, but behaves like an array (maybe a Buffer? Arguments?)
        if (checkInt(arg.length) && checkInts(arg)) {
            return new Uint8Array(arg);
        }

        throw new Error('unsupported array-like object');
    }

    function createArray(length) {
        return new Uint8Array(length);
    }

    function copyArray(sourceArray, targetArray, targetStart, sourceStart, sourceEnd) {
        if (sourceStart != null || sourceEnd != null) {
            if (sourceArray.slice) {
                sourceArray = sourceArray.slice(sourceStart, sourceEnd);
            } else {
                sourceArray = Array.prototype.slice.call(sourceArray, sourceStart, sourceEnd);
            }
        }
        targetArray.set(sourceArray, targetStart);
    }



    var convertUtf8 = (function() {
        function toBytes(text) {
            var result = [], i = 0;
            text = encodeURI(text);
            while (i < text.length) {
                var c = text.charCodeAt(i++);

                // if it is a % sign, encode the following 2 bytes as a hex value
                if (c === 37) {
                    result.push(parseInt(text.substr(i, 2), 16))
                    i += 2;

                // otherwise, just the actual byte
                } else {
                    result.push(c)
                }
            }

            return coerceArray(result);
        }

        function fromBytes(bytes) {
            var result = [], i = 0;

            while (i < bytes.length) {
                var c = bytes[i];

                if (c < 128) {
                    result.push(String.fromCharCode(c));
                    i++;
                } else if (c > 191 && c < 224) {
                    result.push(String.fromCharCode(((c & 0x1f) << 6) | (bytes[i + 1] & 0x3f)));
                    i += 2;
                } else {
                    result.push(String.fromCharCode(((c & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f)));
                    i += 3;
                }
            }

            return result.join('');
        }

        return {
            toBytes: toBytes,
            fromBytes: fromBytes,
        }
    })();

    var convertHex = (function() {
        function toBytes(text) {
            var result = [];
            for (var i = 0; i < text.length; i += 2) {
                result.push(parseInt(text.substr(i, 2), 16));
            }

            return result;
        }

        // http://ixti.net/development/javascript/2011/11/11/base64-encodedecode-of-utf8-in-browser-with-js.html
        var Hex = '0123456789abcdef';

        function fromBytes(bytes) {
                var result = [];
                for (var i = 0; i < bytes.length; i++) {
                    var v = bytes[i];
                    result.push(Hex[(v & 0xf0) >> 4] + Hex[v & 0x0f]);
                }
                return result.join('');
        }

        return {
            toBytes: toBytes,
            fromBytes: fromBytes,
        }
    })();


    // Number of rounds by keysize
    var numberOfRounds = {16: 10, 24: 12, 32: 14}

    // Round constant words
    var rcon = [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36, 0x6c, 0xd8, 0xab, 0x4d, 0x9a, 0x2f, 0x5e, 0xbc, 0x63, 0xc6, 0x97, 0x35, 0x6a, 0xd4, 0xb3, 0x7d, 0xfa, 0xef, 0xc5, 0x91];

    // S-box and Inverse S-box (S is for Substitution)
    var S = [0x63, 0x7c, 0x77, 0x7b, 0xf2, 0x6b, 0x6f, 0xc5, 0x30, 0x01, 0x67, 0x2b, 0xfe, 0xd7, 0xab, 0x76, 0xca, 0x82, 0xc9, 0x7d, 0xfa, 0x59, 0x47, 0xf0, 0xad, 0xd4, 0xa2, 0xaf, 0x9c, 0xa4, 0x72, 0xc0, 0xb7, 0xfd, 0x93, 0x26, 0x36, 0x3f, 0xf7, 0xcc, 0x34, 0xa5, 0xe5, 0xf1, 0x71, 0xd8, 0x31, 0x15, 0x04, 0xc7, 0x23, 0xc3, 0x18, 0x96, 0x05, 0x9a, 0x07, 0x12, 0x80, 0xe2, 0xeb, 0x27, 0xb2, 0x75, 0x09, 0x83, 0x2c, 0x1a, 0x1b, 0x6e, 0x5a, 0xa0, 0x52, 0x3b, 0xd6, 0xb3, 0x29, 0xe3, 0x2f, 0x84, 0x53, 0xd1, 0x00, 0xed, 0x20, 0xfc, 0xb1, 0x5b, 0x6a, 0xcb, 0xbe, 0x39, 0x4a, 0x4c, 0x58, 0xcf, 0xd0, 0xef, 0xaa, 0xfb, 0x43, 0x4d, 0x33, 0x85, 0x45, 0xf9, 0x02, 0x7f, 0x50, 0x3c, 0x9f, 0xa8, 0x51, 0xa3, 0x40, 0x8f, 0x92, 0x9d, 0x38, 0xf5, 0xbc, 0xb6, 0xda, 0x21, 0x10, 0xff, 0xf3, 0xd2, 0xcd, 0x0c, 0x13, 0xec, 0x5f, 0x97, 0x44, 0x17, 0xc4, 0xa7, 0x7e, 0x3d, 0x64, 0x5d, 0x19, 0x73, 0x60, 0x81, 0x4f, 0xdc, 0x22, 0x2a, 0x90, 0x88, 0x46, 0xee, 0xb8, 0x14, 0xde, 0x5e, 0x0b, 0xdb, 0xe0, 0x32, 0x3a, 0x0a, 0x49, 0x06, 0x24, 0x5c, 0xc2, 0xd3, 0xac, 0x62, 0x91, 0x95, 0xe4, 0x79, 0xe7, 0xc8, 0x37, 0x6d, 0x8d, 0xd5, 0x4e, 0xa9, 0x6c, 0x56, 0xf4, 0xea, 0x65, 0x7a, 0xae, 0x08, 0xba, 0x78, 0x25, 0x2e, 0x1c, 0xa6, 0xb4, 0xc6, 0xe8, 0xdd, 0x74, 0x1f, 0x4b, 0xbd, 0x8b, 0x8a, 0x70, 0x3e, 0xb5, 0x66, 0x48, 0x03, 0xf6, 0x0e, 0x61, 0x35, 0x57, 0xb9, 0x86, 0xc1, 0x1d, 0x9e, 0xe1, 0xf8, 0x98, 0x11, 0x69, 0xd9, 0x8e, 0x94, 0x9b, 0x1e, 0x87, 0xe9, 0xce, 0x55, 0x28, 0xdf, 0x8c, 0xa1, 0x89, 0x0d, 0xbf, 0xe6, 0x42, 0x68, 0x41, 0x99, 0x2d, 0x0f, 0xb0, 0x54, 0xbb, 0x16];
    var Si =[0x52, 0x09, 0x6a, 0xd5, 0x30, 0x36, 0xa5, 0x38, 0xbf, 0x40, 0xa3, 0x9e, 0x81, 0xf3, 0xd7, 0xfb, 0x7c, 0xe3, 0x39, 0x82, 0x9b, 0x2f, 0xff, 0x87, 0x34, 0x8e, 0x43, 0x44, 0xc4, 0xde, 0xe9, 0xcb, 0x54, 0x7b, 0x94, 0x32, 0xa6, 0xc2, 0x23, 0x3d, 0xee, 0x4c, 0x95, 0x0b, 0x42, 0xfa, 0xc3, 0x4e, 0x08, 0x2e, 0xa1, 0x66, 0x28, 0xd9, 0x24, 0xb2, 0x76, 0x5b, 0xa2, 0x49, 0x6d, 0x8b, 0xd1, 0x25, 0x72, 0xf8, 0xf6, 0x64, 0x86, 0x68, 0x98, 0x16, 0xd4, 0xa4, 0x5c, 0xcc, 0x5d, 0x65, 0xb6, 0x92, 0x6c, 0x70, 0x48, 0x50, 0xfd, 0xed, 0xb9, 0xda, 0x5e, 0x15, 0x46, 0x57, 0xa7, 0x8d, 0x9d, 0x84, 0x90, 0xd8, 0xab, 0x00, 0x8c, 0xbc, 0xd3, 0x0a, 0xf7, 0xe4, 0x58, 0x05, 0xb8, 0xb3, 0x45, 0x06, 0xd0, 0x2c, 0x1e, 0x8f, 0xca, 0x3f, 0x0f, 0x02, 0xc1, 0xaf, 0xbd, 0x03, 0x01, 0x13, 0x8a, 0x6b, 0x3a, 0x91, 0x11, 0x41, 0x4f, 0x67, 0xdc, 0xea, 0x97, 0xf2, 0xcf, 0xce, 0xf0, 0xb4, 0xe6, 0x73, 0x96, 0xac, 0x74, 0x22, 0xe7, 0xad, 0x35, 0x85, 0xe2, 0xf9, 0x37, 0xe8, 0x1c, 0x75, 0xdf, 0x6e, 0x47, 0xf1, 0x1a, 0x71, 0x1d, 0x29, 0xc5, 0x89, 0x6f, 0xb7, 0x62, 0x0e, 0xaa, 0x18, 0xbe, 0x1b, 0xfc, 0x56, 0x3e, 0x4b, 0xc6, 0xd2, 0x79, 0x20, 0x9a, 0xdb, 0xc0, 0xfe, 0x78, 0xcd, 0x5a, 0xf4, 0x1f, 0xdd, 0xa8, 0x33, 0x88, 0x07, 0xc7, 0x31, 0xb1, 0x12, 0x10, 0x59, 0x27, 0x80, 0xec, 0x5f, 0x60, 0x51, 0x7f, 0xa9, 0x19, 0xb5, 0x4a, 0x0d, 0x2d, 0xe5, 0x7a, 0x9f, 0x93, 0xc9, 0x9c, 0xef, 0xa0, 0xe0, 0x3b, 0x4d, 0xae, 0x2a, 0xf5, 0xb0, 0xc8, 0xeb, 0xbb, 0x3c, 0x83, 0x53, 0x99, 0x61, 0x17, 0x2b, 0x04, 0x7e, 0xba, 0x77, 0xd6, 0x26, 0xe1, 0x69, 0x14, 0x63, 0x55, 0x21, 0x0c, 0x7d];

    // Transformations for encryption
    var T1 = [0xc66363a5, 0xf87c7c84, 0xee777799, 0xf67b7b8d, 0xfff2f20d, 0xd66b6bbd, 0xde6f6fb1, 0x91c5c554, 0x60303050, 0x02010103, 0xce6767a9, 0x562b2b7d, 0xe7fefe19, 0xb5d7d762, 0x4dababe6, 0xec76769a, 0x8fcaca45, 0x1f82829d, 0x89c9c940, 0xfa7d7d87, 0xeffafa15, 0xb25959eb, 0x8e4747c9, 0xfbf0f00b, 0x41adadec, 0xb3d4d467, 0x5fa2a2fd, 0x45afafea, 0x239c9cbf, 0x53a4a4f7, 0xe4727296, 0x9bc0c05b, 0x75b7b7c2, 0xe1fdfd1c, 0x3d9393ae, 0x4c26266a, 0x6c36365a, 0x7e3f3f41, 0xf5f7f702, 0x83cccc4f, 0x6834345c, 0x51a5a5f4, 0xd1e5e534, 0xf9f1f108, 0xe2717193, 0xabd8d873, 0x62313153, 0x2a15153f, 0x0804040c, 0x95c7c752, 0x46232365, 0x9dc3c35e, 0x30181828, 0x379696a1, 0x0a05050f, 0x2f9a9ab5, 0x0e070709, 0x24121236, 0x1b80809b, 0xdfe2e23d, 0xcdebeb26, 0x4e272769, 0x7fb2b2cd, 0xea75759f, 0x1209091b, 0x1d83839e, 0x582c2c74, 0x341a1a2e, 0x361b1b2d, 0xdc6e6eb2, 0xb45a5aee, 0x5ba0a0fb, 0xa45252f6, 0x763b3b4d, 0xb7d6d661, 0x7db3b3ce, 0x5229297b, 0xdde3e33e, 0x5e2f2f71, 0x13848497, 0xa65353f5, 0xb9d1d168, 0x00000000, 0xc1eded2c, 0x40202060, 0xe3fcfc1f, 0x79b1b1c8, 0xb65b5bed, 0xd46a6abe, 0x8dcbcb46, 0x67bebed9, 0x7239394b, 0x944a4ade, 0x984c4cd4, 0xb05858e8, 0x85cfcf4a, 0xbbd0d06b, 0xc5efef2a, 0x4faaaae5, 0xedfbfb16, 0x864343c5, 0x9a4d4dd7, 0x66333355, 0x11858594, 0x8a4545cf, 0xe9f9f910, 0x04020206, 0xfe7f7f81, 0xa05050f0, 0x783c3c44, 0x259f9fba, 0x4ba8a8e3, 0xa25151f3, 0x5da3a3fe, 0x804040c0, 0x058f8f8a, 0x3f9292ad, 0x219d9dbc, 0x70383848, 0xf1f5f504, 0x63bcbcdf, 0x77b6b6c1, 0xafdada75, 0x42212163, 0x20101030, 0xe5ffff1a, 0xfdf3f30e, 0xbfd2d26d, 0x81cdcd4c, 0x180c0c14, 0x26131335, 0xc3ecec2f, 0xbe5f5fe1, 0x359797a2, 0x884444cc, 0x2e171739, 0x93c4c457, 0x55a7a7f2, 0xfc7e7e82, 0x7a3d3d47, 0xc86464ac, 0xba5d5de7, 0x3219192b, 0xe6737395, 0xc06060a0, 0x19818198, 0x9e4f4fd1, 0xa3dcdc7f, 0x44222266, 0x542a2a7e, 0x3b9090ab, 0x0b888883, 0x8c4646ca, 0xc7eeee29, 0x6bb8b8d3, 0x2814143c, 0xa7dede79, 0xbc5e5ee2, 0x160b0b1d, 0xaddbdb76, 0xdbe0e03b, 0x64323256, 0x743a3a4e, 0x140a0a1e, 0x924949db, 0x0c06060a, 0x4824246c, 0xb85c5ce4, 0x9fc2c25d, 0xbdd3d36e, 0x43acacef, 0xc46262a6, 0x399191a8, 0x319595a4, 0xd3e4e437, 0xf279798b, 0xd5e7e732, 0x8bc8c843, 0x6e373759, 0xda6d6db7, 0x018d8d8c, 0xb1d5d564, 0x9c4e4ed2, 0x49a9a9e0, 0xd86c6cb4, 0xac5656fa, 0xf3f4f407, 0xcfeaea25, 0xca6565af, 0xf47a7a8e, 0x47aeaee9, 0x10080818, 0x6fbabad5, 0xf0787888, 0x4a25256f, 0x5c2e2e72, 0x381c1c24, 0x57a6a6f1, 0x73b4b4c7, 0x97c6c651, 0xcbe8e823, 0xa1dddd7c, 0xe874749c, 0x3e1f1f21, 0x964b4bdd, 0x61bdbddc, 0x0d8b8b86, 0x0f8a8a85, 0xe0707090, 0x7c3e3e42, 0x71b5b5c4, 0xcc6666aa, 0x904848d8, 0x06030305, 0xf7f6f601, 0x1c0e0e12, 0xc26161a3, 0x6a35355f, 0xae5757f9, 0x69b9b9d0, 0x17868691, 0x99c1c158, 0x3a1d1d27, 0x279e9eb9, 0xd9e1e138, 0xebf8f813, 0x2b9898b3, 0x22111133, 0xd26969bb, 0xa9d9d970, 0x078e8e89, 0x339494a7, 0x2d9b9bb6, 0x3c1e1e22, 0x15878792, 0xc9e9e920, 0x87cece49, 0xaa5555ff, 0x50282878, 0xa5dfdf7a, 0x038c8c8f, 0x59a1a1f8, 0x09898980, 0x1a0d0d17, 0x65bfbfda, 0xd7e6e631, 0x844242c6, 0xd06868b8, 0x824141c3, 0x299999b0, 0x5a2d2d77, 0x1e0f0f11, 0x7bb0b0cb, 0xa85454fc, 0x6dbbbbd6, 0x2c16163a];
    var T2 = [0xa5c66363, 0x84f87c7c, 0x99ee7777, 0x8df67b7b, 0x0dfff2f2, 0xbdd66b6b, 0xb1de6f6f, 0x5491c5c5, 0x50603030, 0x03020101, 0xa9ce6767, 0x7d562b2b, 0x19e7fefe, 0x62b5d7d7, 0xe64dabab, 0x9aec7676, 0x458fcaca, 0x9d1f8282, 0x4089c9c9, 0x87fa7d7d, 0x15effafa, 0xebb25959, 0xc98e4747, 0x0bfbf0f0, 0xec41adad, 0x67b3d4d4, 0xfd5fa2a2, 0xea45afaf, 0xbf239c9c, 0xf753a4a4, 0x96e47272, 0x5b9bc0c0, 0xc275b7b7, 0x1ce1fdfd, 0xae3d9393, 0x6a4c2626, 0x5a6c3636, 0x417e3f3f, 0x02f5f7f7, 0x4f83cccc, 0x5c683434, 0xf451a5a5, 0x34d1e5e5, 0x08f9f1f1, 0x93e27171, 0x73abd8d8, 0x53623131, 0x3f2a1515, 0x0c080404, 0x5295c7c7, 0x65462323, 0x5e9dc3c3, 0x28301818, 0xa1379696, 0x0f0a0505, 0xb52f9a9a, 0x090e0707, 0x36241212, 0x9b1b8080, 0x3ddfe2e2, 0x26cdebeb, 0x694e2727, 0xcd7fb2b2, 0x9fea7575, 0x1b120909, 0x9e1d8383, 0x74582c2c, 0x2e341a1a, 0x2d361b1b, 0xb2dc6e6e, 0xeeb45a5a, 0xfb5ba0a0, 0xf6a45252, 0x4d763b3b, 0x61b7d6d6, 0xce7db3b3, 0x7b522929, 0x3edde3e3, 0x715e2f2f, 0x97138484, 0xf5a65353, 0x68b9d1d1, 0x00000000, 0x2cc1eded, 0x60402020, 0x1fe3fcfc, 0xc879b1b1, 0xedb65b5b, 0xbed46a6a, 0x468dcbcb, 0xd967bebe, 0x4b723939, 0xde944a4a, 0xd4984c4c, 0xe8b05858, 0x4a85cfcf, 0x6bbbd0d0, 0x2ac5efef, 0xe54faaaa, 0x16edfbfb, 0xc5864343, 0xd79a4d4d, 0x55663333, 0x94118585, 0xcf8a4545, 0x10e9f9f9, 0x06040202, 0x81fe7f7f, 0xf0a05050, 0x44783c3c, 0xba259f9f, 0xe34ba8a8, 0xf3a25151, 0xfe5da3a3, 0xc0804040, 0x8a058f8f, 0xad3f9292, 0xbc219d9d, 0x48703838, 0x04f1f5f5, 0xdf63bcbc, 0xc177b6b6, 0x75afdada, 0x63422121, 0x30201010, 0x1ae5ffff, 0x0efdf3f3, 0x6dbfd2d2, 0x4c81cdcd, 0x14180c0c, 0x35261313, 0x2fc3ecec, 0xe1be5f5f, 0xa2359797, 0xcc884444, 0x392e1717, 0x5793c4c4, 0xf255a7a7, 0x82fc7e7e, 0x477a3d3d, 0xacc86464, 0xe7ba5d5d, 0x2b321919, 0x95e67373, 0xa0c06060, 0x98198181, 0xd19e4f4f, 0x7fa3dcdc, 0x66442222, 0x7e542a2a, 0xab3b9090, 0x830b8888, 0xca8c4646, 0x29c7eeee, 0xd36bb8b8, 0x3c281414, 0x79a7dede, 0xe2bc5e5e, 0x1d160b0b, 0x76addbdb, 0x3bdbe0e0, 0x56643232, 0x4e743a3a, 0x1e140a0a, 0xdb924949, 0x0a0c0606, 0x6c482424, 0xe4b85c5c, 0x5d9fc2c2, 0x6ebdd3d3, 0xef43acac, 0xa6c46262, 0xa8399191, 0xa4319595, 0x37d3e4e4, 0x8bf27979, 0x32d5e7e7, 0x438bc8c8, 0x596e3737, 0xb7da6d6d, 0x8c018d8d, 0x64b1d5d5, 0xd29c4e4e, 0xe049a9a9, 0xb4d86c6c, 0xfaac5656, 0x07f3f4f4, 0x25cfeaea, 0xafca6565, 0x8ef47a7a, 0xe947aeae, 0x18100808, 0xd56fbaba, 0x88f07878, 0x6f4a2525, 0x725c2e2e, 0x24381c1c, 0xf157a6a6, 0xc773b4b4, 0x5197c6c6, 0x23cbe8e8, 0x7ca1dddd, 0x9ce87474, 0x213e1f1f, 0xdd964b4b, 0xdc61bdbd, 0x860d8b8b, 0x850f8a8a, 0x90e07070, 0x427c3e3e, 0xc471b5b5, 0xaacc6666, 0xd8904848, 0x05060303, 0x01f7f6f6, 0x121c0e0e, 0xa3c26161, 0x5f6a3535, 0xf9ae5757, 0xd069b9b9, 0x91178686, 0x5899c1c1, 0x273a1d1d, 0xb9279e9e, 0x38d9e1e1, 0x13ebf8f8, 0xb32b9898, 0x33221111, 0xbbd26969, 0x70a9d9d9, 0x89078e8e, 0xa7339494, 0xb62d9b9b, 0x223c1e1e, 0x92158787, 0x20c9e9e9, 0x4987cece, 0xffaa5555, 0x78502828, 0x7aa5dfdf, 0x8f038c8c, 0xf859a1a1, 0x80098989, 0x171a0d0d, 0xda65bfbf, 0x31d7e6e6, 0xc6844242, 0xb8d06868, 0xc3824141, 0xb0299999, 0x775a2d2d, 0x111e0f0f, 0xcb7bb0b0, 0xfca85454, 0xd66dbbbb, 0x3a2c1616];
    var T3 = [0x63a5c663, 0x7c84f87c, 0x7799ee77, 0x7b8df67b, 0xf20dfff2, 0x6bbdd66b, 0x6fb1de6f, 0xc55491c5, 0x30506030, 0x01030201, 0x67a9ce67, 0x2b7d562b, 0xfe19e7fe, 0xd762b5d7, 0xabe64dab, 0x769aec76, 0xca458fca, 0x829d1f82, 0xc94089c9, 0x7d87fa7d, 0xfa15effa, 0x59ebb259, 0x47c98e47, 0xf00bfbf0, 0xadec41ad, 0xd467b3d4, 0xa2fd5fa2, 0xafea45af, 0x9cbf239c, 0xa4f753a4, 0x7296e472, 0xc05b9bc0, 0xb7c275b7, 0xfd1ce1fd, 0x93ae3d93, 0x266a4c26, 0x365a6c36, 0x3f417e3f, 0xf702f5f7, 0xcc4f83cc, 0x345c6834, 0xa5f451a5, 0xe534d1e5, 0xf108f9f1, 0x7193e271, 0xd873abd8, 0x31536231, 0x153f2a15, 0x040c0804, 0xc75295c7, 0x23654623, 0xc35e9dc3, 0x18283018, 0x96a13796, 0x050f0a05, 0x9ab52f9a, 0x07090e07, 0x12362412, 0x809b1b80, 0xe23ddfe2, 0xeb26cdeb, 0x27694e27, 0xb2cd7fb2, 0x759fea75, 0x091b1209, 0x839e1d83, 0x2c74582c, 0x1a2e341a, 0x1b2d361b, 0x6eb2dc6e, 0x5aeeb45a, 0xa0fb5ba0, 0x52f6a452, 0x3b4d763b, 0xd661b7d6, 0xb3ce7db3, 0x297b5229, 0xe33edde3, 0x2f715e2f, 0x84971384, 0x53f5a653, 0xd168b9d1, 0x00000000, 0xed2cc1ed, 0x20604020, 0xfc1fe3fc, 0xb1c879b1, 0x5bedb65b, 0x6abed46a, 0xcb468dcb, 0xbed967be, 0x394b7239, 0x4ade944a, 0x4cd4984c, 0x58e8b058, 0xcf4a85cf, 0xd06bbbd0, 0xef2ac5ef, 0xaae54faa, 0xfb16edfb, 0x43c58643, 0x4dd79a4d, 0x33556633, 0x85941185, 0x45cf8a45, 0xf910e9f9, 0x02060402, 0x7f81fe7f, 0x50f0a050, 0x3c44783c, 0x9fba259f, 0xa8e34ba8, 0x51f3a251, 0xa3fe5da3, 0x40c08040, 0x8f8a058f, 0x92ad3f92, 0x9dbc219d, 0x38487038, 0xf504f1f5, 0xbcdf63bc, 0xb6c177b6, 0xda75afda, 0x21634221, 0x10302010, 0xff1ae5ff, 0xf30efdf3, 0xd26dbfd2, 0xcd4c81cd, 0x0c14180c, 0x13352613, 0xec2fc3ec, 0x5fe1be5f, 0x97a23597, 0x44cc8844, 0x17392e17, 0xc45793c4, 0xa7f255a7, 0x7e82fc7e, 0x3d477a3d, 0x64acc864, 0x5de7ba5d, 0x192b3219, 0x7395e673, 0x60a0c060, 0x81981981, 0x4fd19e4f, 0xdc7fa3dc, 0x22664422, 0x2a7e542a, 0x90ab3b90, 0x88830b88, 0x46ca8c46, 0xee29c7ee, 0xb8d36bb8, 0x143c2814, 0xde79a7de, 0x5ee2bc5e, 0x0b1d160b, 0xdb76addb, 0xe03bdbe0, 0x32566432, 0x3a4e743a, 0x0a1e140a, 0x49db9249, 0x060a0c06, 0x246c4824, 0x5ce4b85c, 0xc25d9fc2, 0xd36ebdd3, 0xacef43ac, 0x62a6c462, 0x91a83991, 0x95a43195, 0xe437d3e4, 0x798bf279, 0xe732d5e7, 0xc8438bc8, 0x37596e37, 0x6db7da6d, 0x8d8c018d, 0xd564b1d5, 0x4ed29c4e, 0xa9e049a9, 0x6cb4d86c, 0x56faac56, 0xf407f3f4, 0xea25cfea, 0x65afca65, 0x7a8ef47a, 0xaee947ae, 0x08181008, 0xbad56fba, 0x7888f078, 0x256f4a25, 0x2e725c2e, 0x1c24381c, 0xa6f157a6, 0xb4c773b4, 0xc65197c6, 0xe823cbe8, 0xdd7ca1dd, 0x749ce874, 0x1f213e1f, 0x4bdd964b, 0xbddc61bd, 0x8b860d8b, 0x8a850f8a, 0x7090e070, 0x3e427c3e, 0xb5c471b5, 0x66aacc66, 0x48d89048, 0x03050603, 0xf601f7f6, 0x0e121c0e, 0x61a3c261, 0x355f6a35, 0x57f9ae57, 0xb9d069b9, 0x86911786, 0xc15899c1, 0x1d273a1d, 0x9eb9279e, 0xe138d9e1, 0xf813ebf8, 0x98b32b98, 0x11332211, 0x69bbd269, 0xd970a9d9, 0x8e89078e, 0x94a73394, 0x9bb62d9b, 0x1e223c1e, 0x87921587, 0xe920c9e9, 0xce4987ce, 0x55ffaa55, 0x28785028, 0xdf7aa5df, 0x8c8f038c, 0xa1f859a1, 0x89800989, 0x0d171a0d, 0xbfda65bf, 0xe631d7e6, 0x42c68442, 0x68b8d068, 0x41c38241, 0x99b02999, 0x2d775a2d, 0x0f111e0f, 0xb0cb7bb0, 0x54fca854, 0xbbd66dbb, 0x163a2c16];
    var T4 = [0x6363a5c6, 0x7c7c84f8, 0x777799ee, 0x7b7b8df6, 0xf2f20dff, 0x6b6bbdd6, 0x6f6fb1de, 0xc5c55491, 0x30305060, 0x01010302, 0x6767a9ce, 0x2b2b7d56, 0xfefe19e7, 0xd7d762b5, 0xababe64d, 0x76769aec, 0xcaca458f, 0x82829d1f, 0xc9c94089, 0x7d7d87fa, 0xfafa15ef, 0x5959ebb2, 0x4747c98e, 0xf0f00bfb, 0xadadec41, 0xd4d467b3, 0xa2a2fd5f, 0xafafea45, 0x9c9cbf23, 0xa4a4f753, 0x727296e4, 0xc0c05b9b, 0xb7b7c275, 0xfdfd1ce1, 0x9393ae3d, 0x26266a4c, 0x36365a6c, 0x3f3f417e, 0xf7f702f5, 0xcccc4f83, 0x34345c68, 0xa5a5f451, 0xe5e534d1, 0xf1f108f9, 0x717193e2, 0xd8d873ab, 0x31315362, 0x15153f2a, 0x04040c08, 0xc7c75295, 0x23236546, 0xc3c35e9d, 0x18182830, 0x9696a137, 0x05050f0a, 0x9a9ab52f, 0x0707090e, 0x12123624, 0x80809b1b, 0xe2e23ddf, 0xebeb26cd, 0x2727694e, 0xb2b2cd7f, 0x75759fea, 0x09091b12, 0x83839e1d, 0x2c2c7458, 0x1a1a2e34, 0x1b1b2d36, 0x6e6eb2dc, 0x5a5aeeb4, 0xa0a0fb5b, 0x5252f6a4, 0x3b3b4d76, 0xd6d661b7, 0xb3b3ce7d, 0x29297b52, 0xe3e33edd, 0x2f2f715e, 0x84849713, 0x5353f5a6, 0xd1d168b9, 0x00000000, 0xeded2cc1, 0x20206040, 0xfcfc1fe3, 0xb1b1c879, 0x5b5bedb6, 0x6a6abed4, 0xcbcb468d, 0xbebed967, 0x39394b72, 0x4a4ade94, 0x4c4cd498, 0x5858e8b0, 0xcfcf4a85, 0xd0d06bbb, 0xefef2ac5, 0xaaaae54f, 0xfbfb16ed, 0x4343c586, 0x4d4dd79a, 0x33335566, 0x85859411, 0x4545cf8a, 0xf9f910e9, 0x02020604, 0x7f7f81fe, 0x5050f0a0, 0x3c3c4478, 0x9f9fba25, 0xa8a8e34b, 0x5151f3a2, 0xa3a3fe5d, 0x4040c080, 0x8f8f8a05, 0x9292ad3f, 0x9d9dbc21, 0x38384870, 0xf5f504f1, 0xbcbcdf63, 0xb6b6c177, 0xdada75af, 0x21216342, 0x10103020, 0xffff1ae5, 0xf3f30efd, 0xd2d26dbf, 0xcdcd4c81, 0x0c0c1418, 0x13133526, 0xecec2fc3, 0x5f5fe1be, 0x9797a235, 0x4444cc88, 0x1717392e, 0xc4c45793, 0xa7a7f255, 0x7e7e82fc, 0x3d3d477a, 0x6464acc8, 0x5d5de7ba, 0x19192b32, 0x737395e6, 0x6060a0c0, 0x81819819, 0x4f4fd19e, 0xdcdc7fa3, 0x22226644, 0x2a2a7e54, 0x9090ab3b, 0x8888830b, 0x4646ca8c, 0xeeee29c7, 0xb8b8d36b, 0x14143c28, 0xdede79a7, 0x5e5ee2bc, 0x0b0b1d16, 0xdbdb76ad, 0xe0e03bdb, 0x32325664, 0x3a3a4e74, 0x0a0a1e14, 0x4949db92, 0x06060a0c, 0x24246c48, 0x5c5ce4b8, 0xc2c25d9f, 0xd3d36ebd, 0xacacef43, 0x6262a6c4, 0x9191a839, 0x9595a431, 0xe4e437d3, 0x79798bf2, 0xe7e732d5, 0xc8c8438b, 0x3737596e, 0x6d6db7da, 0x8d8d8c01, 0xd5d564b1, 0x4e4ed29c, 0xa9a9e049, 0x6c6cb4d8, 0x5656faac, 0xf4f407f3, 0xeaea25cf, 0x6565afca, 0x7a7a8ef4, 0xaeaee947, 0x08081810, 0xbabad56f, 0x787888f0, 0x25256f4a, 0x2e2e725c, 0x1c1c2438, 0xa6a6f157, 0xb4b4c773, 0xc6c65197, 0xe8e823cb, 0xdddd7ca1, 0x74749ce8, 0x1f1f213e, 0x4b4bdd96, 0xbdbddc61, 0x8b8b860d, 0x8a8a850f, 0x707090e0, 0x3e3e427c, 0xb5b5c471, 0x6666aacc, 0x4848d890, 0x03030506, 0xf6f601f7, 0x0e0e121c, 0x6161a3c2, 0x35355f6a, 0x5757f9ae, 0xb9b9d069, 0x86869117, 0xc1c15899, 0x1d1d273a, 0x9e9eb927, 0xe1e138d9, 0xf8f813eb, 0x9898b32b, 0x11113322, 0x6969bbd2, 0xd9d970a9, 0x8e8e8907, 0x9494a733, 0x9b9bb62d, 0x1e1e223c, 0x87879215, 0xe9e920c9, 0xcece4987, 0x5555ffaa, 0x28287850, 0xdfdf7aa5, 0x8c8c8f03, 0xa1a1f859, 0x89898009, 0x0d0d171a, 0xbfbfda65, 0xe6e631d7, 0x4242c684, 0x6868b8d0, 0x4141c382, 0x9999b029, 0x2d2d775a, 0x0f0f111e, 0xb0b0cb7b, 0x5454fca8, 0xbbbbd66d, 0x16163a2c];

    // Transformations for decryption
    var T5 = [0x51f4a750, 0x7e416553, 0x1a17a4c3, 0x3a275e96, 0x3bab6bcb, 0x1f9d45f1, 0xacfa58ab, 0x4be30393, 0x2030fa55, 0xad766df6, 0x88cc7691, 0xf5024c25, 0x4fe5d7fc, 0xc52acbd7, 0x26354480, 0xb562a38f, 0xdeb15a49, 0x25ba1b67, 0x45ea0e98, 0x5dfec0e1, 0xc32f7502, 0x814cf012, 0x8d4697a3, 0x6bd3f9c6, 0x038f5fe7, 0x15929c95, 0xbf6d7aeb, 0x955259da, 0xd4be832d, 0x587421d3, 0x49e06929, 0x8ec9c844, 0x75c2896a, 0xf48e7978, 0x99583e6b, 0x27b971dd, 0xbee14fb6, 0xf088ad17, 0xc920ac66, 0x7dce3ab4, 0x63df4a18, 0xe51a3182, 0x97513360, 0x62537f45, 0xb16477e0, 0xbb6bae84, 0xfe81a01c, 0xf9082b94, 0x70486858, 0x8f45fd19, 0x94de6c87, 0x527bf8b7, 0xab73d323, 0x724b02e2, 0xe31f8f57, 0x6655ab2a, 0xb2eb2807, 0x2fb5c203, 0x86c57b9a, 0xd33708a5, 0x302887f2, 0x23bfa5b2, 0x02036aba, 0xed16825c, 0x8acf1c2b, 0xa779b492, 0xf307f2f0, 0x4e69e2a1, 0x65daf4cd, 0x0605bed5, 0xd134621f, 0xc4a6fe8a, 0x342e539d, 0xa2f355a0, 0x058ae132, 0xa4f6eb75, 0x0b83ec39, 0x4060efaa, 0x5e719f06, 0xbd6e1051, 0x3e218af9, 0x96dd063d, 0xdd3e05ae, 0x4de6bd46, 0x91548db5, 0x71c45d05, 0x0406d46f, 0x605015ff, 0x1998fb24, 0xd6bde997, 0x894043cc, 0x67d99e77, 0xb0e842bd, 0x07898b88, 0xe7195b38, 0x79c8eedb, 0xa17c0a47, 0x7c420fe9, 0xf8841ec9, 0x00000000, 0x09808683, 0x322bed48, 0x1e1170ac, 0x6c5a724e, 0xfd0efffb, 0x0f853856, 0x3daed51e, 0x362d3927, 0x0a0fd964, 0x685ca621, 0x9b5b54d1, 0x24362e3a, 0x0c0a67b1, 0x9357e70f, 0xb4ee96d2, 0x1b9b919e, 0x80c0c54f, 0x61dc20a2, 0x5a774b69, 0x1c121a16, 0xe293ba0a, 0xc0a02ae5, 0x3c22e043, 0x121b171d, 0x0e090d0b, 0xf28bc7ad, 0x2db6a8b9, 0x141ea9c8, 0x57f11985, 0xaf75074c, 0xee99ddbb, 0xa37f60fd, 0xf701269f, 0x5c72f5bc, 0x44663bc5, 0x5bfb7e34, 0x8b432976, 0xcb23c6dc, 0xb6edfc68, 0xb8e4f163, 0xd731dcca, 0x42638510, 0x13972240, 0x84c61120, 0x854a247d, 0xd2bb3df8, 0xaef93211, 0xc729a16d, 0x1d9e2f4b, 0xdcb230f3, 0x0d8652ec, 0x77c1e3d0, 0x2bb3166c, 0xa970b999, 0x119448fa, 0x47e96422, 0xa8fc8cc4, 0xa0f03f1a, 0x567d2cd8, 0x223390ef, 0x87494ec7, 0xd938d1c1, 0x8ccaa2fe, 0x98d40b36, 0xa6f581cf, 0xa57ade28, 0xdab78e26, 0x3fadbfa4, 0x2c3a9de4, 0x5078920d, 0x6a5fcc9b, 0x547e4662, 0xf68d13c2, 0x90d8b8e8, 0x2e39f75e, 0x82c3aff5, 0x9f5d80be, 0x69d0937c, 0x6fd52da9, 0xcf2512b3, 0xc8ac993b, 0x10187da7, 0xe89c636e, 0xdb3bbb7b, 0xcd267809, 0x6e5918f4, 0xec9ab701, 0x834f9aa8, 0xe6956e65, 0xaaffe67e, 0x21bccf08, 0xef15e8e6, 0xbae79bd9, 0x4a6f36ce, 0xea9f09d4, 0x29b07cd6, 0x31a4b2af, 0x2a3f2331, 0xc6a59430, 0x35a266c0, 0x744ebc37, 0xfc82caa6, 0xe090d0b0, 0x33a7d815, 0xf104984a, 0x41ecdaf7, 0x7fcd500e, 0x1791f62f, 0x764dd68d, 0x43efb04d, 0xccaa4d54, 0xe49604df, 0x9ed1b5e3, 0x4c6a881b, 0xc12c1fb8, 0x4665517f, 0x9d5eea04, 0x018c355d, 0xfa877473, 0xfb0b412e, 0xb3671d5a, 0x92dbd252, 0xe9105633, 0x6dd64713, 0x9ad7618c, 0x37a10c7a, 0x59f8148e, 0xeb133c89, 0xcea927ee, 0xb761c935, 0xe11ce5ed, 0x7a47b13c, 0x9cd2df59, 0x55f2733f, 0x1814ce79, 0x73c737bf, 0x53f7cdea, 0x5ffdaa5b, 0xdf3d6f14, 0x7844db86, 0xcaaff381, 0xb968c43e, 0x3824342c, 0xc2a3405f, 0x161dc372, 0xbce2250c, 0x283c498b, 0xff0d9541, 0x39a80171, 0x080cb3de, 0xd8b4e49c, 0x6456c190, 0x7bcb8461, 0xd532b670, 0x486c5c74, 0xd0b85742];
    var T6 = [0x5051f4a7, 0x537e4165, 0xc31a17a4, 0x963a275e, 0xcb3bab6b, 0xf11f9d45, 0xabacfa58, 0x934be303, 0x552030fa, 0xf6ad766d, 0x9188cc76, 0x25f5024c, 0xfc4fe5d7, 0xd7c52acb, 0x80263544, 0x8fb562a3, 0x49deb15a, 0x6725ba1b, 0x9845ea0e, 0xe15dfec0, 0x02c32f75, 0x12814cf0, 0xa38d4697, 0xc66bd3f9, 0xe7038f5f, 0x9515929c, 0xebbf6d7a, 0xda955259, 0x2dd4be83, 0xd3587421, 0x2949e069, 0x448ec9c8, 0x6a75c289, 0x78f48e79, 0x6b99583e, 0xdd27b971, 0xb6bee14f, 0x17f088ad, 0x66c920ac, 0xb47dce3a, 0x1863df4a, 0x82e51a31, 0x60975133, 0x4562537f, 0xe0b16477, 0x84bb6bae, 0x1cfe81a0, 0x94f9082b, 0x58704868, 0x198f45fd, 0x8794de6c, 0xb7527bf8, 0x23ab73d3, 0xe2724b02, 0x57e31f8f, 0x2a6655ab, 0x07b2eb28, 0x032fb5c2, 0x9a86c57b, 0xa5d33708, 0xf2302887, 0xb223bfa5, 0xba02036a, 0x5ced1682, 0x2b8acf1c, 0x92a779b4, 0xf0f307f2, 0xa14e69e2, 0xcd65daf4, 0xd50605be, 0x1fd13462, 0x8ac4a6fe, 0x9d342e53, 0xa0a2f355, 0x32058ae1, 0x75a4f6eb, 0x390b83ec, 0xaa4060ef, 0x065e719f, 0x51bd6e10, 0xf93e218a, 0x3d96dd06, 0xaedd3e05, 0x464de6bd, 0xb591548d, 0x0571c45d, 0x6f0406d4, 0xff605015, 0x241998fb, 0x97d6bde9, 0xcc894043, 0x7767d99e, 0xbdb0e842, 0x8807898b, 0x38e7195b, 0xdb79c8ee, 0x47a17c0a, 0xe97c420f, 0xc9f8841e, 0x00000000, 0x83098086, 0x48322bed, 0xac1e1170, 0x4e6c5a72, 0xfbfd0eff, 0x560f8538, 0x1e3daed5, 0x27362d39, 0x640a0fd9, 0x21685ca6, 0xd19b5b54, 0x3a24362e, 0xb10c0a67, 0x0f9357e7, 0xd2b4ee96, 0x9e1b9b91, 0x4f80c0c5, 0xa261dc20, 0x695a774b, 0x161c121a, 0x0ae293ba, 0xe5c0a02a, 0x433c22e0, 0x1d121b17, 0x0b0e090d, 0xadf28bc7, 0xb92db6a8, 0xc8141ea9, 0x8557f119, 0x4caf7507, 0xbbee99dd, 0xfda37f60, 0x9ff70126, 0xbc5c72f5, 0xc544663b, 0x345bfb7e, 0x768b4329, 0xdccb23c6, 0x68b6edfc, 0x63b8e4f1, 0xcad731dc, 0x10426385, 0x40139722, 0x2084c611, 0x7d854a24, 0xf8d2bb3d, 0x11aef932, 0x6dc729a1, 0x4b1d9e2f, 0xf3dcb230, 0xec0d8652, 0xd077c1e3, 0x6c2bb316, 0x99a970b9, 0xfa119448, 0x2247e964, 0xc4a8fc8c, 0x1aa0f03f, 0xd8567d2c, 0xef223390, 0xc787494e, 0xc1d938d1, 0xfe8ccaa2, 0x3698d40b, 0xcfa6f581, 0x28a57ade, 0x26dab78e, 0xa43fadbf, 0xe42c3a9d, 0x0d507892, 0x9b6a5fcc, 0x62547e46, 0xc2f68d13, 0xe890d8b8, 0x5e2e39f7, 0xf582c3af, 0xbe9f5d80, 0x7c69d093, 0xa96fd52d, 0xb3cf2512, 0x3bc8ac99, 0xa710187d, 0x6ee89c63, 0x7bdb3bbb, 0x09cd2678, 0xf46e5918, 0x01ec9ab7, 0xa8834f9a, 0x65e6956e, 0x7eaaffe6, 0x0821bccf, 0xe6ef15e8, 0xd9bae79b, 0xce4a6f36, 0xd4ea9f09, 0xd629b07c, 0xaf31a4b2, 0x312a3f23, 0x30c6a594, 0xc035a266, 0x37744ebc, 0xa6fc82ca, 0xb0e090d0, 0x1533a7d8, 0x4af10498, 0xf741ecda, 0x0e7fcd50, 0x2f1791f6, 0x8d764dd6, 0x4d43efb0, 0x54ccaa4d, 0xdfe49604, 0xe39ed1b5, 0x1b4c6a88, 0xb8c12c1f, 0x7f466551, 0x049d5eea, 0x5d018c35, 0x73fa8774, 0x2efb0b41, 0x5ab3671d, 0x5292dbd2, 0x33e91056, 0x136dd647, 0x8c9ad761, 0x7a37a10c, 0x8e59f814, 0x89eb133c, 0xeecea927, 0x35b761c9, 0xede11ce5, 0x3c7a47b1, 0x599cd2df, 0x3f55f273, 0x791814ce, 0xbf73c737, 0xea53f7cd, 0x5b5ffdaa, 0x14df3d6f, 0x867844db, 0x81caaff3, 0x3eb968c4, 0x2c382434, 0x5fc2a340, 0x72161dc3, 0x0cbce225, 0x8b283c49, 0x41ff0d95, 0x7139a801, 0xde080cb3, 0x9cd8b4e4, 0x906456c1, 0x617bcb84, 0x70d532b6, 0x74486c5c, 0x42d0b857];
    var T7 = [0xa75051f4, 0x65537e41, 0xa4c31a17, 0x5e963a27, 0x6bcb3bab, 0x45f11f9d, 0x58abacfa, 0x03934be3, 0xfa552030, 0x6df6ad76, 0x769188cc, 0x4c25f502, 0xd7fc4fe5, 0xcbd7c52a, 0x44802635, 0xa38fb562, 0x5a49deb1, 0x1b6725ba, 0x0e9845ea, 0xc0e15dfe, 0x7502c32f, 0xf012814c, 0x97a38d46, 0xf9c66bd3, 0x5fe7038f, 0x9c951592, 0x7aebbf6d, 0x59da9552, 0x832dd4be, 0x21d35874, 0x692949e0, 0xc8448ec9, 0x896a75c2, 0x7978f48e, 0x3e6b9958, 0x71dd27b9, 0x4fb6bee1, 0xad17f088, 0xac66c920, 0x3ab47dce, 0x4a1863df, 0x3182e51a, 0x33609751, 0x7f456253, 0x77e0b164, 0xae84bb6b, 0xa01cfe81, 0x2b94f908, 0x68587048, 0xfd198f45, 0x6c8794de, 0xf8b7527b, 0xd323ab73, 0x02e2724b, 0x8f57e31f, 0xab2a6655, 0x2807b2eb, 0xc2032fb5, 0x7b9a86c5, 0x08a5d337, 0x87f23028, 0xa5b223bf, 0x6aba0203, 0x825ced16, 0x1c2b8acf, 0xb492a779, 0xf2f0f307, 0xe2a14e69, 0xf4cd65da, 0xbed50605, 0x621fd134, 0xfe8ac4a6, 0x539d342e, 0x55a0a2f3, 0xe132058a, 0xeb75a4f6, 0xec390b83, 0xefaa4060, 0x9f065e71, 0x1051bd6e, 0x8af93e21, 0x063d96dd, 0x05aedd3e, 0xbd464de6, 0x8db59154, 0x5d0571c4, 0xd46f0406, 0x15ff6050, 0xfb241998, 0xe997d6bd, 0x43cc8940, 0x9e7767d9, 0x42bdb0e8, 0x8b880789, 0x5b38e719, 0xeedb79c8, 0x0a47a17c, 0x0fe97c42, 0x1ec9f884, 0x00000000, 0x86830980, 0xed48322b, 0x70ac1e11, 0x724e6c5a, 0xfffbfd0e, 0x38560f85, 0xd51e3dae, 0x3927362d, 0xd9640a0f, 0xa621685c, 0x54d19b5b, 0x2e3a2436, 0x67b10c0a, 0xe70f9357, 0x96d2b4ee, 0x919e1b9b, 0xc54f80c0, 0x20a261dc, 0x4b695a77, 0x1a161c12, 0xba0ae293, 0x2ae5c0a0, 0xe0433c22, 0x171d121b, 0x0d0b0e09, 0xc7adf28b, 0xa8b92db6, 0xa9c8141e, 0x198557f1, 0x074caf75, 0xddbbee99, 0x60fda37f, 0x269ff701, 0xf5bc5c72, 0x3bc54466, 0x7e345bfb, 0x29768b43, 0xc6dccb23, 0xfc68b6ed, 0xf163b8e4, 0xdccad731, 0x85104263, 0x22401397, 0x112084c6, 0x247d854a, 0x3df8d2bb, 0x3211aef9, 0xa16dc729, 0x2f4b1d9e, 0x30f3dcb2, 0x52ec0d86, 0xe3d077c1, 0x166c2bb3, 0xb999a970, 0x48fa1194, 0x642247e9, 0x8cc4a8fc, 0x3f1aa0f0, 0x2cd8567d, 0x90ef2233, 0x4ec78749, 0xd1c1d938, 0xa2fe8cca, 0x0b3698d4, 0x81cfa6f5, 0xde28a57a, 0x8e26dab7, 0xbfa43fad, 0x9de42c3a, 0x920d5078, 0xcc9b6a5f, 0x4662547e, 0x13c2f68d, 0xb8e890d8, 0xf75e2e39, 0xaff582c3, 0x80be9f5d, 0x937c69d0, 0x2da96fd5, 0x12b3cf25, 0x993bc8ac, 0x7da71018, 0x636ee89c, 0xbb7bdb3b, 0x7809cd26, 0x18f46e59, 0xb701ec9a, 0x9aa8834f, 0x6e65e695, 0xe67eaaff, 0xcf0821bc, 0xe8e6ef15, 0x9bd9bae7, 0x36ce4a6f, 0x09d4ea9f, 0x7cd629b0, 0xb2af31a4, 0x23312a3f, 0x9430c6a5, 0x66c035a2, 0xbc37744e, 0xcaa6fc82, 0xd0b0e090, 0xd81533a7, 0x984af104, 0xdaf741ec, 0x500e7fcd, 0xf62f1791, 0xd68d764d, 0xb04d43ef, 0x4d54ccaa, 0x04dfe496, 0xb5e39ed1, 0x881b4c6a, 0x1fb8c12c, 0x517f4665, 0xea049d5e, 0x355d018c, 0x7473fa87, 0x412efb0b, 0x1d5ab367, 0xd25292db, 0x5633e910, 0x47136dd6, 0x618c9ad7, 0x0c7a37a1, 0x148e59f8, 0x3c89eb13, 0x27eecea9, 0xc935b761, 0xe5ede11c, 0xb13c7a47, 0xdf599cd2, 0x733f55f2, 0xce791814, 0x37bf73c7, 0xcdea53f7, 0xaa5b5ffd, 0x6f14df3d, 0xdb867844, 0xf381caaf, 0xc43eb968, 0x342c3824, 0x405fc2a3, 0xc372161d, 0x250cbce2, 0x498b283c, 0x9541ff0d, 0x017139a8, 0xb3de080c, 0xe49cd8b4, 0xc1906456, 0x84617bcb, 0xb670d532, 0x5c74486c, 0x5742d0b8];
    var T8 = [0xf4a75051, 0x4165537e, 0x17a4c31a, 0x275e963a, 0xab6bcb3b, 0x9d45f11f, 0xfa58abac, 0xe303934b, 0x30fa5520, 0x766df6ad, 0xcc769188, 0x024c25f5, 0xe5d7fc4f, 0x2acbd7c5, 0x35448026, 0x62a38fb5, 0xb15a49de, 0xba1b6725, 0xea0e9845, 0xfec0e15d, 0x2f7502c3, 0x4cf01281, 0x4697a38d, 0xd3f9c66b, 0x8f5fe703, 0x929c9515, 0x6d7aebbf, 0x5259da95, 0xbe832dd4, 0x7421d358, 0xe0692949, 0xc9c8448e, 0xc2896a75, 0x8e7978f4, 0x583e6b99, 0xb971dd27, 0xe14fb6be, 0x88ad17f0, 0x20ac66c9, 0xce3ab47d, 0xdf4a1863, 0x1a3182e5, 0x51336097, 0x537f4562, 0x6477e0b1, 0x6bae84bb, 0x81a01cfe, 0x082b94f9, 0x48685870, 0x45fd198f, 0xde6c8794, 0x7bf8b752, 0x73d323ab, 0x4b02e272, 0x1f8f57e3, 0x55ab2a66, 0xeb2807b2, 0xb5c2032f, 0xc57b9a86, 0x3708a5d3, 0x2887f230, 0xbfa5b223, 0x036aba02, 0x16825ced, 0xcf1c2b8a, 0x79b492a7, 0x07f2f0f3, 0x69e2a14e, 0xdaf4cd65, 0x05bed506, 0x34621fd1, 0xa6fe8ac4, 0x2e539d34, 0xf355a0a2, 0x8ae13205, 0xf6eb75a4, 0x83ec390b, 0x60efaa40, 0x719f065e, 0x6e1051bd, 0x218af93e, 0xdd063d96, 0x3e05aedd, 0xe6bd464d, 0x548db591, 0xc45d0571, 0x06d46f04, 0x5015ff60, 0x98fb2419, 0xbde997d6, 0x4043cc89, 0xd99e7767, 0xe842bdb0, 0x898b8807, 0x195b38e7, 0xc8eedb79, 0x7c0a47a1, 0x420fe97c, 0x841ec9f8, 0x00000000, 0x80868309, 0x2bed4832, 0x1170ac1e, 0x5a724e6c, 0x0efffbfd, 0x8538560f, 0xaed51e3d, 0x2d392736, 0x0fd9640a, 0x5ca62168, 0x5b54d19b, 0x362e3a24, 0x0a67b10c, 0x57e70f93, 0xee96d2b4, 0x9b919e1b, 0xc0c54f80, 0xdc20a261, 0x774b695a, 0x121a161c, 0x93ba0ae2, 0xa02ae5c0, 0x22e0433c, 0x1b171d12, 0x090d0b0e, 0x8bc7adf2, 0xb6a8b92d, 0x1ea9c814, 0xf1198557, 0x75074caf, 0x99ddbbee, 0x7f60fda3, 0x01269ff7, 0x72f5bc5c, 0x663bc544, 0xfb7e345b, 0x4329768b, 0x23c6dccb, 0xedfc68b6, 0xe4f163b8, 0x31dccad7, 0x63851042, 0x97224013, 0xc6112084, 0x4a247d85, 0xbb3df8d2, 0xf93211ae, 0x29a16dc7, 0x9e2f4b1d, 0xb230f3dc, 0x8652ec0d, 0xc1e3d077, 0xb3166c2b, 0x70b999a9, 0x9448fa11, 0xe9642247, 0xfc8cc4a8, 0xf03f1aa0, 0x7d2cd856, 0x3390ef22, 0x494ec787, 0x38d1c1d9, 0xcaa2fe8c, 0xd40b3698, 0xf581cfa6, 0x7ade28a5, 0xb78e26da, 0xadbfa43f, 0x3a9de42c, 0x78920d50, 0x5fcc9b6a, 0x7e466254, 0x8d13c2f6, 0xd8b8e890, 0x39f75e2e, 0xc3aff582, 0x5d80be9f, 0xd0937c69, 0xd52da96f, 0x2512b3cf, 0xac993bc8, 0x187da710, 0x9c636ee8, 0x3bbb7bdb, 0x267809cd, 0x5918f46e, 0x9ab701ec, 0x4f9aa883, 0x956e65e6, 0xffe67eaa, 0xbccf0821, 0x15e8e6ef, 0xe79bd9ba, 0x6f36ce4a, 0x9f09d4ea, 0xb07cd629, 0xa4b2af31, 0x3f23312a, 0xa59430c6, 0xa266c035, 0x4ebc3774, 0x82caa6fc, 0x90d0b0e0, 0xa7d81533, 0x04984af1, 0xecdaf741, 0xcd500e7f, 0x91f62f17, 0x4dd68d76, 0xefb04d43, 0xaa4d54cc, 0x9604dfe4, 0xd1b5e39e, 0x6a881b4c, 0x2c1fb8c1, 0x65517f46, 0x5eea049d, 0x8c355d01, 0x877473fa, 0x0b412efb, 0x671d5ab3, 0xdbd25292, 0x105633e9, 0xd647136d, 0xd7618c9a, 0xa10c7a37, 0xf8148e59, 0x133c89eb, 0xa927eece, 0x61c935b7, 0x1ce5ede1, 0x47b13c7a, 0xd2df599c, 0xf2733f55, 0x14ce7918, 0xc737bf73, 0xf7cdea53, 0xfdaa5b5f, 0x3d6f14df, 0x44db8678, 0xaff381ca, 0x68c43eb9, 0x24342c38, 0xa3405fc2, 0x1dc37216, 0xe2250cbc, 0x3c498b28, 0x0d9541ff, 0xa8017139, 0x0cb3de08, 0xb4e49cd8, 0x56c19064, 0xcb84617b, 0x32b670d5, 0x6c5c7448, 0xb85742d0];

    // Transformations for decryption key expansion
    var U1 = [0x00000000, 0x0e090d0b, 0x1c121a16, 0x121b171d, 0x3824342c, 0x362d3927, 0x24362e3a, 0x2a3f2331, 0x70486858, 0x7e416553, 0x6c5a724e, 0x62537f45, 0x486c5c74, 0x4665517f, 0x547e4662, 0x5a774b69, 0xe090d0b0, 0xee99ddbb, 0xfc82caa6, 0xf28bc7ad, 0xd8b4e49c, 0xd6bde997, 0xc4a6fe8a, 0xcaaff381, 0x90d8b8e8, 0x9ed1b5e3, 0x8ccaa2fe, 0x82c3aff5, 0xa8fc8cc4, 0xa6f581cf, 0xb4ee96d2, 0xbae79bd9, 0xdb3bbb7b, 0xd532b670, 0xc729a16d, 0xc920ac66, 0xe31f8f57, 0xed16825c, 0xff0d9541, 0xf104984a, 0xab73d323, 0xa57ade28, 0xb761c935, 0xb968c43e, 0x9357e70f, 0x9d5eea04, 0x8f45fd19, 0x814cf012, 0x3bab6bcb, 0x35a266c0, 0x27b971dd, 0x29b07cd6, 0x038f5fe7, 0x0d8652ec, 0x1f9d45f1, 0x119448fa, 0x4be30393, 0x45ea0e98, 0x57f11985, 0x59f8148e, 0x73c737bf, 0x7dce3ab4, 0x6fd52da9, 0x61dc20a2, 0xad766df6, 0xa37f60fd, 0xb16477e0, 0xbf6d7aeb, 0x955259da, 0x9b5b54d1, 0x894043cc, 0x87494ec7, 0xdd3e05ae, 0xd33708a5, 0xc12c1fb8, 0xcf2512b3, 0xe51a3182, 0xeb133c89, 0xf9082b94, 0xf701269f, 0x4de6bd46, 0x43efb04d, 0x51f4a750, 0x5ffdaa5b, 0x75c2896a, 0x7bcb8461, 0x69d0937c, 0x67d99e77, 0x3daed51e, 0x33a7d815, 0x21bccf08, 0x2fb5c203, 0x058ae132, 0x0b83ec39, 0x1998fb24, 0x1791f62f, 0x764dd68d, 0x7844db86, 0x6a5fcc9b, 0x6456c190, 0x4e69e2a1, 0x4060efaa, 0x527bf8b7, 0x5c72f5bc, 0x0605bed5, 0x080cb3de, 0x1a17a4c3, 0x141ea9c8, 0x3e218af9, 0x302887f2, 0x223390ef, 0x2c3a9de4, 0x96dd063d, 0x98d40b36, 0x8acf1c2b, 0x84c61120, 0xaef93211, 0xa0f03f1a, 0xb2eb2807, 0xbce2250c, 0xe6956e65, 0xe89c636e, 0xfa877473, 0xf48e7978, 0xdeb15a49, 0xd0b85742, 0xc2a3405f, 0xccaa4d54, 0x41ecdaf7, 0x4fe5d7fc, 0x5dfec0e1, 0x53f7cdea, 0x79c8eedb, 0x77c1e3d0, 0x65daf4cd, 0x6bd3f9c6, 0x31a4b2af, 0x3fadbfa4, 0x2db6a8b9, 0x23bfa5b2, 0x09808683, 0x07898b88, 0x15929c95, 0x1b9b919e, 0xa17c0a47, 0xaf75074c, 0xbd6e1051, 0xb3671d5a, 0x99583e6b, 0x97513360, 0x854a247d, 0x8b432976, 0xd134621f, 0xdf3d6f14, 0xcd267809, 0xc32f7502, 0xe9105633, 0xe7195b38, 0xf5024c25, 0xfb0b412e, 0x9ad7618c, 0x94de6c87, 0x86c57b9a, 0x88cc7691, 0xa2f355a0, 0xacfa58ab, 0xbee14fb6, 0xb0e842bd, 0xea9f09d4, 0xe49604df, 0xf68d13c2, 0xf8841ec9, 0xd2bb3df8, 0xdcb230f3, 0xcea927ee, 0xc0a02ae5, 0x7a47b13c, 0x744ebc37, 0x6655ab2a, 0x685ca621, 0x42638510, 0x4c6a881b, 0x5e719f06, 0x5078920d, 0x0a0fd964, 0x0406d46f, 0x161dc372, 0x1814ce79, 0x322bed48, 0x3c22e043, 0x2e39f75e, 0x2030fa55, 0xec9ab701, 0xe293ba0a, 0xf088ad17, 0xfe81a01c, 0xd4be832d, 0xdab78e26, 0xc8ac993b, 0xc6a59430, 0x9cd2df59, 0x92dbd252, 0x80c0c54f, 0x8ec9c844, 0xa4f6eb75, 0xaaffe67e, 0xb8e4f163, 0xb6edfc68, 0x0c0a67b1, 0x02036aba, 0x10187da7, 0x1e1170ac, 0x342e539d, 0x3a275e96, 0x283c498b, 0x26354480, 0x7c420fe9, 0x724b02e2, 0x605015ff, 0x6e5918f4, 0x44663bc5, 0x4a6f36ce, 0x587421d3, 0x567d2cd8, 0x37a10c7a, 0x39a80171, 0x2bb3166c, 0x25ba1b67, 0x0f853856, 0x018c355d, 0x13972240, 0x1d9e2f4b, 0x47e96422, 0x49e06929, 0x5bfb7e34, 0x55f2733f, 0x7fcd500e, 0x71c45d05, 0x63df4a18, 0x6dd64713, 0xd731dcca, 0xd938d1c1, 0xcb23c6dc, 0xc52acbd7, 0xef15e8e6, 0xe11ce5ed, 0xf307f2f0, 0xfd0efffb, 0xa779b492, 0xa970b999, 0xbb6bae84, 0xb562a38f, 0x9f5d80be, 0x91548db5, 0x834f9aa8, 0x8d4697a3];
    var U2 = [0x00000000, 0x0b0e090d, 0x161c121a, 0x1d121b17, 0x2c382434, 0x27362d39, 0x3a24362e, 0x312a3f23, 0x58704868, 0x537e4165, 0x4e6c5a72, 0x4562537f, 0x74486c5c, 0x7f466551, 0x62547e46, 0x695a774b, 0xb0e090d0, 0xbbee99dd, 0xa6fc82ca, 0xadf28bc7, 0x9cd8b4e4, 0x97d6bde9, 0x8ac4a6fe, 0x81caaff3, 0xe890d8b8, 0xe39ed1b5, 0xfe8ccaa2, 0xf582c3af, 0xc4a8fc8c, 0xcfa6f581, 0xd2b4ee96, 0xd9bae79b, 0x7bdb3bbb, 0x70d532b6, 0x6dc729a1, 0x66c920ac, 0x57e31f8f, 0x5ced1682, 0x41ff0d95, 0x4af10498, 0x23ab73d3, 0x28a57ade, 0x35b761c9, 0x3eb968c4, 0x0f9357e7, 0x049d5eea, 0x198f45fd, 0x12814cf0, 0xcb3bab6b, 0xc035a266, 0xdd27b971, 0xd629b07c, 0xe7038f5f, 0xec0d8652, 0xf11f9d45, 0xfa119448, 0x934be303, 0x9845ea0e, 0x8557f119, 0x8e59f814, 0xbf73c737, 0xb47dce3a, 0xa96fd52d, 0xa261dc20, 0xf6ad766d, 0xfda37f60, 0xe0b16477, 0xebbf6d7a, 0xda955259, 0xd19b5b54, 0xcc894043, 0xc787494e, 0xaedd3e05, 0xa5d33708, 0xb8c12c1f, 0xb3cf2512, 0x82e51a31, 0x89eb133c, 0x94f9082b, 0x9ff70126, 0x464de6bd, 0x4d43efb0, 0x5051f4a7, 0x5b5ffdaa, 0x6a75c289, 0x617bcb84, 0x7c69d093, 0x7767d99e, 0x1e3daed5, 0x1533a7d8, 0x0821bccf, 0x032fb5c2, 0x32058ae1, 0x390b83ec, 0x241998fb, 0x2f1791f6, 0x8d764dd6, 0x867844db, 0x9b6a5fcc, 0x906456c1, 0xa14e69e2, 0xaa4060ef, 0xb7527bf8, 0xbc5c72f5, 0xd50605be, 0xde080cb3, 0xc31a17a4, 0xc8141ea9, 0xf93e218a, 0xf2302887, 0xef223390, 0xe42c3a9d, 0x3d96dd06, 0x3698d40b, 0x2b8acf1c, 0x2084c611, 0x11aef932, 0x1aa0f03f, 0x07b2eb28, 0x0cbce225, 0x65e6956e, 0x6ee89c63, 0x73fa8774, 0x78f48e79, 0x49deb15a, 0x42d0b857, 0x5fc2a340, 0x54ccaa4d, 0xf741ecda, 0xfc4fe5d7, 0xe15dfec0, 0xea53f7cd, 0xdb79c8ee, 0xd077c1e3, 0xcd65daf4, 0xc66bd3f9, 0xaf31a4b2, 0xa43fadbf, 0xb92db6a8, 0xb223bfa5, 0x83098086, 0x8807898b, 0x9515929c, 0x9e1b9b91, 0x47a17c0a, 0x4caf7507, 0x51bd6e10, 0x5ab3671d, 0x6b99583e, 0x60975133, 0x7d854a24, 0x768b4329, 0x1fd13462, 0x14df3d6f, 0x09cd2678, 0x02c32f75, 0x33e91056, 0x38e7195b, 0x25f5024c, 0x2efb0b41, 0x8c9ad761, 0x8794de6c, 0x9a86c57b, 0x9188cc76, 0xa0a2f355, 0xabacfa58, 0xb6bee14f, 0xbdb0e842, 0xd4ea9f09, 0xdfe49604, 0xc2f68d13, 0xc9f8841e, 0xf8d2bb3d, 0xf3dcb230, 0xeecea927, 0xe5c0a02a, 0x3c7a47b1, 0x37744ebc, 0x2a6655ab, 0x21685ca6, 0x10426385, 0x1b4c6a88, 0x065e719f, 0x0d507892, 0x640a0fd9, 0x6f0406d4, 0x72161dc3, 0x791814ce, 0x48322bed, 0x433c22e0, 0x5e2e39f7, 0x552030fa, 0x01ec9ab7, 0x0ae293ba, 0x17f088ad, 0x1cfe81a0, 0x2dd4be83, 0x26dab78e, 0x3bc8ac99, 0x30c6a594, 0x599cd2df, 0x5292dbd2, 0x4f80c0c5, 0x448ec9c8, 0x75a4f6eb, 0x7eaaffe6, 0x63b8e4f1, 0x68b6edfc, 0xb10c0a67, 0xba02036a, 0xa710187d, 0xac1e1170, 0x9d342e53, 0x963a275e, 0x8b283c49, 0x80263544, 0xe97c420f, 0xe2724b02, 0xff605015, 0xf46e5918, 0xc544663b, 0xce4a6f36, 0xd3587421, 0xd8567d2c, 0x7a37a10c, 0x7139a801, 0x6c2bb316, 0x6725ba1b, 0x560f8538, 0x5d018c35, 0x40139722, 0x4b1d9e2f, 0x2247e964, 0x2949e069, 0x345bfb7e, 0x3f55f273, 0x0e7fcd50, 0x0571c45d, 0x1863df4a, 0x136dd647, 0xcad731dc, 0xc1d938d1, 0xdccb23c6, 0xd7c52acb, 0xe6ef15e8, 0xede11ce5, 0xf0f307f2, 0xfbfd0eff, 0x92a779b4, 0x99a970b9, 0x84bb6bae, 0x8fb562a3, 0xbe9f5d80, 0xb591548d, 0xa8834f9a, 0xa38d4697];
    var U3 = [0x00000000, 0x0d0b0e09, 0x1a161c12, 0x171d121b, 0x342c3824, 0x3927362d, 0x2e3a2436, 0x23312a3f, 0x68587048, 0x65537e41, 0x724e6c5a, 0x7f456253, 0x5c74486c, 0x517f4665, 0x4662547e, 0x4b695a77, 0xd0b0e090, 0xddbbee99, 0xcaa6fc82, 0xc7adf28b, 0xe49cd8b4, 0xe997d6bd, 0xfe8ac4a6, 0xf381caaf, 0xb8e890d8, 0xb5e39ed1, 0xa2fe8cca, 0xaff582c3, 0x8cc4a8fc, 0x81cfa6f5, 0x96d2b4ee, 0x9bd9bae7, 0xbb7bdb3b, 0xb670d532, 0xa16dc729, 0xac66c920, 0x8f57e31f, 0x825ced16, 0x9541ff0d, 0x984af104, 0xd323ab73, 0xde28a57a, 0xc935b761, 0xc43eb968, 0xe70f9357, 0xea049d5e, 0xfd198f45, 0xf012814c, 0x6bcb3bab, 0x66c035a2, 0x71dd27b9, 0x7cd629b0, 0x5fe7038f, 0x52ec0d86, 0x45f11f9d, 0x48fa1194, 0x03934be3, 0x0e9845ea, 0x198557f1, 0x148e59f8, 0x37bf73c7, 0x3ab47dce, 0x2da96fd5, 0x20a261dc, 0x6df6ad76, 0x60fda37f, 0x77e0b164, 0x7aebbf6d, 0x59da9552, 0x54d19b5b, 0x43cc8940, 0x4ec78749, 0x05aedd3e, 0x08a5d337, 0x1fb8c12c, 0x12b3cf25, 0x3182e51a, 0x3c89eb13, 0x2b94f908, 0x269ff701, 0xbd464de6, 0xb04d43ef, 0xa75051f4, 0xaa5b5ffd, 0x896a75c2, 0x84617bcb, 0x937c69d0, 0x9e7767d9, 0xd51e3dae, 0xd81533a7, 0xcf0821bc, 0xc2032fb5, 0xe132058a, 0xec390b83, 0xfb241998, 0xf62f1791, 0xd68d764d, 0xdb867844, 0xcc9b6a5f, 0xc1906456, 0xe2a14e69, 0xefaa4060, 0xf8b7527b, 0xf5bc5c72, 0xbed50605, 0xb3de080c, 0xa4c31a17, 0xa9c8141e, 0x8af93e21, 0x87f23028, 0x90ef2233, 0x9de42c3a, 0x063d96dd, 0x0b3698d4, 0x1c2b8acf, 0x112084c6, 0x3211aef9, 0x3f1aa0f0, 0x2807b2eb, 0x250cbce2, 0x6e65e695, 0x636ee89c, 0x7473fa87, 0x7978f48e, 0x5a49deb1, 0x5742d0b8, 0x405fc2a3, 0x4d54ccaa, 0xdaf741ec, 0xd7fc4fe5, 0xc0e15dfe, 0xcdea53f7, 0xeedb79c8, 0xe3d077c1, 0xf4cd65da, 0xf9c66bd3, 0xb2af31a4, 0xbfa43fad, 0xa8b92db6, 0xa5b223bf, 0x86830980, 0x8b880789, 0x9c951592, 0x919e1b9b, 0x0a47a17c, 0x074caf75, 0x1051bd6e, 0x1d5ab367, 0x3e6b9958, 0x33609751, 0x247d854a, 0x29768b43, 0x621fd134, 0x6f14df3d, 0x7809cd26, 0x7502c32f, 0x5633e910, 0x5b38e719, 0x4c25f502, 0x412efb0b, 0x618c9ad7, 0x6c8794de, 0x7b9a86c5, 0x769188cc, 0x55a0a2f3, 0x58abacfa, 0x4fb6bee1, 0x42bdb0e8, 0x09d4ea9f, 0x04dfe496, 0x13c2f68d, 0x1ec9f884, 0x3df8d2bb, 0x30f3dcb2, 0x27eecea9, 0x2ae5c0a0, 0xb13c7a47, 0xbc37744e, 0xab2a6655, 0xa621685c, 0x85104263, 0x881b4c6a, 0x9f065e71, 0x920d5078, 0xd9640a0f, 0xd46f0406, 0xc372161d, 0xce791814, 0xed48322b, 0xe0433c22, 0xf75e2e39, 0xfa552030, 0xb701ec9a, 0xba0ae293, 0xad17f088, 0xa01cfe81, 0x832dd4be, 0x8e26dab7, 0x993bc8ac, 0x9430c6a5, 0xdf599cd2, 0xd25292db, 0xc54f80c0, 0xc8448ec9, 0xeb75a4f6, 0xe67eaaff, 0xf163b8e4, 0xfc68b6ed, 0x67b10c0a, 0x6aba0203, 0x7da71018, 0x70ac1e11, 0x539d342e, 0x5e963a27, 0x498b283c, 0x44802635, 0x0fe97c42, 0x02e2724b, 0x15ff6050, 0x18f46e59, 0x3bc54466, 0x36ce4a6f, 0x21d35874, 0x2cd8567d, 0x0c7a37a1, 0x017139a8, 0x166c2bb3, 0x1b6725ba, 0x38560f85, 0x355d018c, 0x22401397, 0x2f4b1d9e, 0x642247e9, 0x692949e0, 0x7e345bfb, 0x733f55f2, 0x500e7fcd, 0x5d0571c4, 0x4a1863df, 0x47136dd6, 0xdccad731, 0xd1c1d938, 0xc6dccb23, 0xcbd7c52a, 0xe8e6ef15, 0xe5ede11c, 0xf2f0f307, 0xfffbfd0e, 0xb492a779, 0xb999a970, 0xae84bb6b, 0xa38fb562, 0x80be9f5d, 0x8db59154, 0x9aa8834f, 0x97a38d46];
    var U4 = [0x00000000, 0x090d0b0e, 0x121a161c, 0x1b171d12, 0x24342c38, 0x2d392736, 0x362e3a24, 0x3f23312a, 0x48685870, 0x4165537e, 0x5a724e6c, 0x537f4562, 0x6c5c7448, 0x65517f46, 0x7e466254, 0x774b695a, 0x90d0b0e0, 0x99ddbbee, 0x82caa6fc, 0x8bc7adf2, 0xb4e49cd8, 0xbde997d6, 0xa6fe8ac4, 0xaff381ca, 0xd8b8e890, 0xd1b5e39e, 0xcaa2fe8c, 0xc3aff582, 0xfc8cc4a8, 0xf581cfa6, 0xee96d2b4, 0xe79bd9ba, 0x3bbb7bdb, 0x32b670d5, 0x29a16dc7, 0x20ac66c9, 0x1f8f57e3, 0x16825ced, 0x0d9541ff, 0x04984af1, 0x73d323ab, 0x7ade28a5, 0x61c935b7, 0x68c43eb9, 0x57e70f93, 0x5eea049d, 0x45fd198f, 0x4cf01281, 0xab6bcb3b, 0xa266c035, 0xb971dd27, 0xb07cd629, 0x8f5fe703, 0x8652ec0d, 0x9d45f11f, 0x9448fa11, 0xe303934b, 0xea0e9845, 0xf1198557, 0xf8148e59, 0xc737bf73, 0xce3ab47d, 0xd52da96f, 0xdc20a261, 0x766df6ad, 0x7f60fda3, 0x6477e0b1, 0x6d7aebbf, 0x5259da95, 0x5b54d19b, 0x4043cc89, 0x494ec787, 0x3e05aedd, 0x3708a5d3, 0x2c1fb8c1, 0x2512b3cf, 0x1a3182e5, 0x133c89eb, 0x082b94f9, 0x01269ff7, 0xe6bd464d, 0xefb04d43, 0xf4a75051, 0xfdaa5b5f, 0xc2896a75, 0xcb84617b, 0xd0937c69, 0xd99e7767, 0xaed51e3d, 0xa7d81533, 0xbccf0821, 0xb5c2032f, 0x8ae13205, 0x83ec390b, 0x98fb2419, 0x91f62f17, 0x4dd68d76, 0x44db8678, 0x5fcc9b6a, 0x56c19064, 0x69e2a14e, 0x60efaa40, 0x7bf8b752, 0x72f5bc5c, 0x05bed506, 0x0cb3de08, 0x17a4c31a, 0x1ea9c814, 0x218af93e, 0x2887f230, 0x3390ef22, 0x3a9de42c, 0xdd063d96, 0xd40b3698, 0xcf1c2b8a, 0xc6112084, 0xf93211ae, 0xf03f1aa0, 0xeb2807b2, 0xe2250cbc, 0x956e65e6, 0x9c636ee8, 0x877473fa, 0x8e7978f4, 0xb15a49de, 0xb85742d0, 0xa3405fc2, 0xaa4d54cc, 0xecdaf741, 0xe5d7fc4f, 0xfec0e15d, 0xf7cdea53, 0xc8eedb79, 0xc1e3d077, 0xdaf4cd65, 0xd3f9c66b, 0xa4b2af31, 0xadbfa43f, 0xb6a8b92d, 0xbfa5b223, 0x80868309, 0x898b8807, 0x929c9515, 0x9b919e1b, 0x7c0a47a1, 0x75074caf, 0x6e1051bd, 0x671d5ab3, 0x583e6b99, 0x51336097, 0x4a247d85, 0x4329768b, 0x34621fd1, 0x3d6f14df, 0x267809cd, 0x2f7502c3, 0x105633e9, 0x195b38e7, 0x024c25f5, 0x0b412efb, 0xd7618c9a, 0xde6c8794, 0xc57b9a86, 0xcc769188, 0xf355a0a2, 0xfa58abac, 0xe14fb6be, 0xe842bdb0, 0x9f09d4ea, 0x9604dfe4, 0x8d13c2f6, 0x841ec9f8, 0xbb3df8d2, 0xb230f3dc, 0xa927eece, 0xa02ae5c0, 0x47b13c7a, 0x4ebc3774, 0x55ab2a66, 0x5ca62168, 0x63851042, 0x6a881b4c, 0x719f065e, 0x78920d50, 0x0fd9640a, 0x06d46f04, 0x1dc37216, 0x14ce7918, 0x2bed4832, 0x22e0433c, 0x39f75e2e, 0x30fa5520, 0x9ab701ec, 0x93ba0ae2, 0x88ad17f0, 0x81a01cfe, 0xbe832dd4, 0xb78e26da, 0xac993bc8, 0xa59430c6, 0xd2df599c, 0xdbd25292, 0xc0c54f80, 0xc9c8448e, 0xf6eb75a4, 0xffe67eaa, 0xe4f163b8, 0xedfc68b6, 0x0a67b10c, 0x036aba02, 0x187da710, 0x1170ac1e, 0x2e539d34, 0x275e963a, 0x3c498b28, 0x35448026, 0x420fe97c, 0x4b02e272, 0x5015ff60, 0x5918f46e, 0x663bc544, 0x6f36ce4a, 0x7421d358, 0x7d2cd856, 0xa10c7a37, 0xa8017139, 0xb3166c2b, 0xba1b6725, 0x8538560f, 0x8c355d01, 0x97224013, 0x9e2f4b1d, 0xe9642247, 0xe0692949, 0xfb7e345b, 0xf2733f55, 0xcd500e7f, 0xc45d0571, 0xdf4a1863, 0xd647136d, 0x31dccad7, 0x38d1c1d9, 0x23c6dccb, 0x2acbd7c5, 0x15e8e6ef, 0x1ce5ede1, 0x07f2f0f3, 0x0efffbfd, 0x79b492a7, 0x70b999a9, 0x6bae84bb, 0x62a38fb5, 0x5d80be9f, 0x548db591, 0x4f9aa883, 0x4697a38d];

    function convertToInt32(bytes) {
        var result = [];
        for (var i = 0; i < bytes.length; i += 4) {
            result.push(
                (bytes[i    ] << 24) |
                (bytes[i + 1] << 16) |
                (bytes[i + 2] <<  8) |
                 bytes[i + 3]
            );
        }
        return result;
    }

    var AES = function(key) {
        if (!(this instanceof AES)) {
            throw Error('AES must be instanitated with \`new\`');
        }

        Object.defineProperty(this, 'key', {
            value: coerceArray(key, true)
        });

        this._prepare();
    }


    AES.prototype._prepare = function() {

        var rounds = numberOfRounds[this.key.length];
        if (rounds == null) {
            throw new Error('invalid key size (must be 16, 24 or 32 bytes)');
        }

        // encryption round keys
        this._Ke = [];

        // decryption round keys
        this._Kd = [];

        for (var i = 0; i <= rounds; i++) {
            this._Ke.push([0, 0, 0, 0]);
            this._Kd.push([0, 0, 0, 0]);
        }

        var roundKeyCount = (rounds + 1) * 4;
        var KC = this.key.length / 4;

        // convert the key into ints
        var tk = convertToInt32(this.key);

        // copy values into round key arrays
        var index;
        for (var i = 0; i < KC; i++) {
            index = i >> 2;
            this._Ke[index][i % 4] = tk[i];
            this._Kd[rounds - index][i % 4] = tk[i];
        }

        // key expansion (fips-197 section 5.2)
        var rconpointer = 0;
        var t = KC, tt;
        while (t < roundKeyCount) {
            tt = tk[KC - 1];
            tk[0] ^= ((S[(tt >> 16) & 0xFF] << 24) ^
                      (S[(tt >>  8) & 0xFF] << 16) ^
                      (S[ tt        & 0xFF] <<  8) ^
                       S[(tt >> 24) & 0xFF]        ^
                      (rcon[rconpointer] << 24));
            rconpointer += 1;

            // key expansion (for non-256 bit)
            if (KC != 8) {
                for (var i = 1; i < KC; i++) {
                    tk[i] ^= tk[i - 1];
                }

            // key expansion for 256-bit keys is "slightly different" (fips-197)
            } else {
                for (var i = 1; i < (KC / 2); i++) {
                    tk[i] ^= tk[i - 1];
                }
                tt = tk[(KC / 2) - 1];

                tk[KC / 2] ^= (S[ tt        & 0xFF]        ^
                              (S[(tt >>  8) & 0xFF] <<  8) ^
                              (S[(tt >> 16) & 0xFF] << 16) ^
                              (S[(tt >> 24) & 0xFF] << 24));

                for (var i = (KC / 2) + 1; i < KC; i++) {
                    tk[i] ^= tk[i - 1];
                }
            }

            // copy values into round key arrays
            var i = 0, r, c;
            while (i < KC && t < roundKeyCount) {
                r = t >> 2;
                c = t % 4;
                this._Ke[r][c] = tk[i];
                this._Kd[rounds - r][c] = tk[i++];
                t++;
            }
        }

        // inverse-cipher-ify the decryption round key (fips-197 section 5.3)
        for (var r = 1; r < rounds; r++) {
            for (var c = 0; c < 4; c++) {
                tt = this._Kd[r][c];
                this._Kd[r][c] = (U1[(tt >> 24) & 0xFF] ^
                                  U2[(tt >> 16) & 0xFF] ^
                                  U3[(tt >>  8) & 0xFF] ^
                                  U4[ tt        & 0xFF]);
            }
        }
    }

    AES.prototype.encrypt = function(plaintext) {
        if (plaintext.length != 16) {
            throw new Error('invalid plaintext size (must be 16 bytes)');
        }

        var rounds = this._Ke.length - 1;
        var a = [0, 0, 0, 0];

        // convert plaintext to (ints ^ key)
        var t = convertToInt32(plaintext);
        for (var i = 0; i < 4; i++) {
            t[i] ^= this._Ke[0][i];
        }

        // apply round transforms
        for (var r = 1; r < rounds; r++) {
            for (var i = 0; i < 4; i++) {
                a[i] = (T1[(t[ i         ] >> 24) & 0xff] ^
                        T2[(t[(i + 1) % 4] >> 16) & 0xff] ^
                        T3[(t[(i + 2) % 4] >>  8) & 0xff] ^
                        T4[ t[(i + 3) % 4]        & 0xff] ^
                        this._Ke[r][i]);
            }
            t = a.slice();
        }

        // the last round is special
        var result = createArray(16), tt;
        for (var i = 0; i < 4; i++) {
            tt = this._Ke[rounds][i];
            result[4 * i    ] = (S[(t[ i         ] >> 24) & 0xff] ^ (tt >> 24)) & 0xff;
            result[4 * i + 1] = (S[(t[(i + 1) % 4] >> 16) & 0xff] ^ (tt >> 16)) & 0xff;
            result[4 * i + 2] = (S[(t[(i + 2) % 4] >>  8) & 0xff] ^ (tt >>  8)) & 0xff;
            result[4 * i + 3] = (S[ t[(i + 3) % 4]        & 0xff] ^  tt       ) & 0xff;
        }

        return result;
    }

    AES.prototype.decrypt = function(ciphertext) {
        if (ciphertext.length != 16) {
            throw new Error('invalid ciphertext size (must be 16 bytes)');
        }

        var rounds = this._Kd.length - 1;
        var a = [0, 0, 0, 0];

        // convert plaintext to (ints ^ key)
        var t = convertToInt32(ciphertext);
        for (var i = 0; i < 4; i++) {
            t[i] ^= this._Kd[0][i];
        }

        // apply round transforms
        for (var r = 1; r < rounds; r++) {
            for (var i = 0; i < 4; i++) {
                a[i] = (T5[(t[ i          ] >> 24) & 0xff] ^
                        T6[(t[(i + 3) % 4] >> 16) & 0xff] ^
                        T7[(t[(i + 2) % 4] >>  8) & 0xff] ^
                        T8[ t[(i + 1) % 4]        & 0xff] ^
                        this._Kd[r][i]);
            }
            t = a.slice();
        }

        // the last round is special
        var result = createArray(16), tt;
        for (var i = 0; i < 4; i++) {
            tt = this._Kd[rounds][i];
            result[4 * i    ] = (Si[(t[ i         ] >> 24) & 0xff] ^ (tt >> 24)) & 0xff;
            result[4 * i + 1] = (Si[(t[(i + 3) % 4] >> 16) & 0xff] ^ (tt >> 16)) & 0xff;
            result[4 * i + 2] = (Si[(t[(i + 2) % 4] >>  8) & 0xff] ^ (tt >>  8)) & 0xff;
            result[4 * i + 3] = (Si[ t[(i + 1) % 4]        & 0xff] ^  tt       ) & 0xff;
        }

        return result;
    }


    /**
     *  Mode Of Operation - Electonic Codebook (ECB)
     */
    var ModeOfOperationECB = function(key) {
        if (!(this instanceof ModeOfOperationECB)) {
            throw Error('AES must be instanitated with \`new\`');
        }

        this.description = "Electronic Code Block";
        this.name = "ecb";

        this._aes = new AES(key);
    }

    ModeOfOperationECB.prototype.encrypt = function(plaintext) {
        plaintext = coerceArray(plaintext);

        if ((plaintext.length % 16) !== 0) {
            throw new Error('invalid plaintext size (must be multiple of 16 bytes)');
        }

        var ciphertext = createArray(plaintext.length);
        var block = createArray(16);

        for (var i = 0; i < plaintext.length; i += 16) {
            copyArray(plaintext, block, 0, i, i + 16);
            block = this._aes.encrypt(block);
            copyArray(block, ciphertext, i);
        }

        return ciphertext;
    }

    ModeOfOperationECB.prototype.decrypt = function(ciphertext) {
        ciphertext = coerceArray(ciphertext);

        if ((ciphertext.length % 16) !== 0) {
            throw new Error('invalid ciphertext size (must be multiple of 16 bytes)');
        }

        var plaintext = createArray(ciphertext.length);
        var block = createArray(16);

        for (var i = 0; i < ciphertext.length; i += 16) {
            copyArray(ciphertext, block, 0, i, i + 16);
            block = this._aes.decrypt(block);
            copyArray(block, plaintext, i);
        }

        return plaintext;
    }


    /**
     *  Mode Of Operation - Cipher Block Chaining (CBC)
     */
    var ModeOfOperationCBC = function(key, iv) {
        if (!(this instanceof ModeOfOperationCBC)) {
            throw Error('AES must be instanitated with \`new\`');
        }

        this.description = "Cipher Block Chaining";
        this.name = "cbc";

        if (!iv) {
            iv = createArray(16);

        } else if (iv.length != 16) {
            throw new Error('invalid initialation vector size (must be 16 bytes)');
        }

        this._lastCipherblock = coerceArray(iv, true);

        this._aes = new AES(key);
    }

    ModeOfOperationCBC.prototype.encrypt = function(plaintext) {
        plaintext = coerceArray(plaintext);

        if ((plaintext.length % 16) !== 0) {
            throw new Error('invalid plaintext size (must be multiple of 16 bytes)');
        }

        var ciphertext = createArray(plaintext.length);
        var block = createArray(16);

        for (var i = 0; i < plaintext.length; i += 16) {
            copyArray(plaintext, block, 0, i, i + 16);

            for (var j = 0; j < 16; j++) {
                block[j] ^= this._lastCipherblock[j];
            }

            this._lastCipherblock = this._aes.encrypt(block);
            copyArray(this._lastCipherblock, ciphertext, i);
        }

        return ciphertext;
    }

    ModeOfOperationCBC.prototype.decrypt = function(ciphertext) {
        ciphertext = coerceArray(ciphertext);

        if ((ciphertext.length % 16) !== 0) {
            throw new Error('invalid ciphertext size (must be multiple of 16 bytes)');
        }

        var plaintext = createArray(ciphertext.length);
        var block = createArray(16);

        for (var i = 0; i < ciphertext.length; i += 16) {
            copyArray(ciphertext, block, 0, i, i + 16);
            block = this._aes.decrypt(block);

            for (var j = 0; j < 16; j++) {
                plaintext[i + j] = block[j] ^ this._lastCipherblock[j];
            }

            copyArray(ciphertext, this._lastCipherblock, 0, i, i + 16);
        }

        return plaintext;
    }


    /**
     *  Mode Of Operation - Cipher Feedback (CFB)
     */
    var ModeOfOperationCFB = function(key, iv, segmentSize) {
        if (!(this instanceof ModeOfOperationCFB)) {
            throw Error('AES must be instanitated with \`new\`');
        }

        this.description = "Cipher Feedback";
        this.name = "cfb";

        if (!iv) {
            iv = createArray(16);

        } else if (iv.length != 16) {
            throw new Error('invalid initialation vector size (must be 16 size)');
        }

        if (!segmentSize) { segmentSize = 1; }

        this.segmentSize = segmentSize;

        this._shiftRegister = coerceArray(iv, true);

        this._aes = new AES(key);
    }

    ModeOfOperationCFB.prototype.encrypt = function(plaintext) {
        if ((plaintext.length % this.segmentSize) != 0) {
            throw new Error('invalid plaintext size (must be segmentSize bytes)');
        }

        var encrypted = coerceArray(plaintext, true);

        var xorSegment;
        for (var i = 0; i < encrypted.length; i += this.segmentSize) {
            xorSegment = this._aes.encrypt(this._shiftRegister);
            for (var j = 0; j < this.segmentSize; j++) {
                encrypted[i + j] ^= xorSegment[j];
            }

            // Shift the register
            copyArray(this._shiftRegister, this._shiftRegister, 0, this.segmentSize);
            copyArray(encrypted, this._shiftRegister, 16 - this.segmentSize, i, i + this.segmentSize);
        }

        return encrypted;
    }

    ModeOfOperationCFB.prototype.decrypt = function(ciphertext) {
        if ((ciphertext.length % this.segmentSize) != 0) {
            throw new Error('invalid ciphertext size (must be segmentSize bytes)');
        }

        var plaintext = coerceArray(ciphertext, true);

        var xorSegment;
        for (var i = 0; i < plaintext.length; i += this.segmentSize) {
            xorSegment = this._aes.encrypt(this._shiftRegister);

            for (var j = 0; j < this.segmentSize; j++) {
                plaintext[i + j] ^= xorSegment[j];
            }

            // Shift the register
            copyArray(this._shiftRegister, this._shiftRegister, 0, this.segmentSize);
            copyArray(ciphertext, this._shiftRegister, 16 - this.segmentSize, i, i + this.segmentSize);
        }

        return plaintext;
    }

    /**
     *  Mode Of Operation - Output Feedback (OFB)
     */
    var ModeOfOperationOFB = function(key, iv) {
        if (!(this instanceof ModeOfOperationOFB)) {
            throw Error('AES must be instanitated with \`new\`');
        }

        this.description = "Output Feedback";
        this.name = "ofb";

        if (!iv) {
            iv = createArray(16);

        } else if (iv.length != 16) {
            throw new Error('invalid initialation vector size (must be 16 bytes)');
        }

        this._lastPrecipher = coerceArray(iv, true);
        this._lastPrecipherIndex = 16;

        this._aes = new AES(key);
    }

    ModeOfOperationOFB.prototype.encrypt = function(plaintext) {
        var encrypted = coerceArray(plaintext, true);

        for (var i = 0; i < encrypted.length; i++) {
            if (this._lastPrecipherIndex === 16) {
                this._lastPrecipher = this._aes.encrypt(this._lastPrecipher);
                this._lastPrecipherIndex = 0;
            }
            encrypted[i] ^= this._lastPrecipher[this._lastPrecipherIndex++];
        }

        return encrypted;
    }

    // Decryption is symetric
    ModeOfOperationOFB.prototype.decrypt = ModeOfOperationOFB.prototype.encrypt;


    /**
     *  Counter object for CTR common mode of operation
     */
    var Counter = function(initialValue) {
        if (!(this instanceof Counter)) {
            throw Error('Counter must be instanitated with \`new\`');
        }

        // We allow 0, but anything false-ish uses the default 1
        if (initialValue !== 0 && !initialValue) { initialValue = 1; }

        if (typeof(initialValue) === 'number') {
            this._counter = createArray(16);
            this.setValue(initialValue);

        } else {
            this.setBytes(initialValue);
        }
    }

    Counter.prototype.setValue = function(value) {
        if (typeof(value) !== 'number' || parseInt(value) != value) {
            throw new Error('invalid counter value (must be an integer)');
        }

        // We cannot safely handle numbers beyond the safe range for integers
        if (value > Number.MAX_SAFE_INTEGER) {
            throw new Error('integer value out of safe range');
        }

        for (var index = 15; index >= 0; --index) {
            this._counter[index] = value % 256;
            value = parseInt(value / 256);
        }
    }

    Counter.prototype.setBytes = function(bytes) {
        bytes = coerceArray(bytes, true);

        if (bytes.length != 16) {
            throw new Error('invalid counter bytes size (must be 16 bytes)');
        }

        this._counter = bytes;
    };

    Counter.prototype.increment = function() {
        for (var i = 15; i >= 0; i--) {
            if (this._counter[i] === 255) {
                this._counter[i] = 0;
            } else {
                this._counter[i]++;
                break;
            }
        }
    }


    /**
     *  Mode Of Operation - Counter (CTR)
     */
    var ModeOfOperationCTR = function(key, counter) {
        if (!(this instanceof ModeOfOperationCTR)) {
            throw Error('AES must be instanitated with \`new\`');
        }

        this.description = "Counter";
        this.name = "ctr";

        if (!(counter instanceof Counter)) {
            counter = new Counter(counter)
        }

        this._counter = counter;

        this._remainingCounter = null;
        this._remainingCounterIndex = 16;

        this._aes = new AES(key);
    }

    ModeOfOperationCTR.prototype.encrypt = function(plaintext) {
        var encrypted = coerceArray(plaintext, true);

        for (var i = 0; i < encrypted.length; i++) {
            if (this._remainingCounterIndex === 16) {
                this._remainingCounter = this._aes.encrypt(this._counter._counter);
                this._remainingCounterIndex = 0;
                this._counter.increment();
            }
            encrypted[i] ^= this._remainingCounter[this._remainingCounterIndex++];
        }

        return encrypted;
    }

    // Decryption is symetric
    ModeOfOperationCTR.prototype.decrypt = ModeOfOperationCTR.prototype.encrypt;


    ///////////////////////
    // Padding

    // See:https://tools.ietf.org/html/rfc2315
    function pkcs7pad(data) {
        data = coerceArray(data, true);
        var padder = 16 - (data.length % 16);
        var result = createArray(data.length + padder);
        copyArray(data, result);
        for (var i = data.length; i < result.length; i++) {
            result[i] = padder;
        }
        return result;
    }

    function pkcs7strip(data) {
        data = coerceArray(data, true);
        if (data.length < 16) { throw new Error('PKCS#7 invalid length'); }

        var padder = data[data.length - 1];
        if (padder > 16) { throw new Error('PKCS#7 padding byte out of range'); }

        var length = data.length - padder;
        for (var i = 0; i < padder; i++) {
            if (data[length + i] !== padder) {
                throw new Error('PKCS#7 invalid padding byte');
            }
        }

        var result = createArray(length);
        copyArray(data, result, 0, 0, length);
        return result;
    }

    ///////////////////////
    // Exporting


    // The block cipher
    var aesjs = {
        AES: AES,
        Counter: Counter,

        ModeOfOperation: {
            ecb: ModeOfOperationECB,
            cbc: ModeOfOperationCBC,
            cfb: ModeOfOperationCFB,
            ofb: ModeOfOperationOFB,
            ctr: ModeOfOperationCTR
        },

        utils: {
            hex: convertHex,
            utf8: convertUtf8
        },

        padding: {
            pkcs7: {
                pad: pkcs7pad,
                strip: pkcs7strip
            }
        },

        _arrayTest: {
            coerceArray: coerceArray,
            createArray: createArray,
            copyArray: copyArray,
        }
    };


    // node.js
    if (typeof exports !== 'undefined') {
        module.exports = aesjs

    // RequireJS/AMD
    // http://www.requirejs.org/docs/api.html
    // https://github.com/amdjs/amdjs-api/wiki/AMD
    } else if (typeof(define) === 'function' && define.amd) {
        define([], function() { return aesjs; });

    // Web Browsers
    } else {

        // If there was an existing library at "aesjs" make sure it's still available
        if (root.aesjs) {
            aesjs._aesjs = root.aesjs;
        }

        root.aesjs = aesjs;
    }


})(this);`;
export const VENDOR_AES_JS_JS_HASH = "b1b8a63af601";

export const VENDOR_QRCODEJS_JS = `var QRCode;!function(){function a(a){this.mode=c.MODE_8BIT_BYTE,this.data=a,this.parsedData=[];for(var b=[],d=0,e=this.data.length;e>d;d++){var f=this.data.charCodeAt(d);f>65536?(b[0]=240|(1835008&f)>>>18,b[1]=128|(258048&f)>>>12,b[2]=128|(4032&f)>>>6,b[3]=128|63&f):f>2048?(b[0]=224|(61440&f)>>>12,b[1]=128|(4032&f)>>>6,b[2]=128|63&f):f>128?(b[0]=192|(1984&f)>>>6,b[1]=128|63&f):b[0]=f,this.parsedData=this.parsedData.concat(b)}this.parsedData.length!=this.data.length&&(this.parsedData.unshift(191),this.parsedData.unshift(187),this.parsedData.unshift(239))}function b(a,b){this.typeNumber=a,this.errorCorrectLevel=b,this.modules=null,this.moduleCount=0,this.dataCache=null,this.dataList=[]}function i(a,b){if(void 0==a.length)throw new Error(a.length+"/"+b);for(var c=0;c<a.length&&0==a[c];)c++;this.num=new Array(a.length-c+b);for(var d=0;d<a.length-c;d++)this.num[d]=a[d+c]}function j(a,b){this.totalCount=a,this.dataCount=b}function k(){this.buffer=[],this.length=0}function m(){return"undefined"!=typeof CanvasRenderingContext2D}function n(){var a=!1,b=navigator.userAgent;return/android/i.test(b)&&(a=!0,aMat=b.toString().match(/android ([0-9]\\.[0-9])/i),aMat&&aMat[1]&&(a=parseFloat(aMat[1]))),a}function r(a,b){for(var c=1,e=s(a),f=0,g=l.length;g>=f;f++){var h=0;switch(b){case d.L:h=l[f][0];break;case d.M:h=l[f][1];break;case d.Q:h=l[f][2];break;case d.H:h=l[f][3]}if(h>=e)break;c++}if(c>l.length)throw new Error("Too long data");return c}function s(a){var b=encodeURI(a).toString().replace(/\\%[0-9a-fA-F]{2}/g,"a");return b.length+(b.length!=a?3:0)}a.prototype={getLength:function(){return this.parsedData.length},write:function(a){for(var b=0,c=this.parsedData.length;c>b;b++)a.put(this.parsedData[b],8)}},b.prototype={addData:function(b){var c=new a(b);this.dataList.push(c),this.dataCache=null},isDark:function(a,b){if(0>a||this.moduleCount<=a||0>b||this.moduleCount<=b)throw new Error(a+","+b);return this.modules[a][b]},getModuleCount:function(){return this.moduleCount},make:function(){this.makeImpl(!1,this.getBestMaskPattern())},makeImpl:function(a,c){this.moduleCount=4*this.typeNumber+17,this.modules=new Array(this.moduleCount);for(var d=0;d<this.moduleCount;d++){this.modules[d]=new Array(this.moduleCount);for(var e=0;e<this.moduleCount;e++)this.modules[d][e]=null}this.setupPositionProbePattern(0,0),this.setupPositionProbePattern(this.moduleCount-7,0),this.setupPositionProbePattern(0,this.moduleCount-7),this.setupPositionAdjustPattern(),this.setupTimingPattern(),this.setupTypeInfo(a,c),this.typeNumber>=7&&this.setupTypeNumber(a),null==this.dataCache&&(this.dataCache=b.createData(this.typeNumber,this.errorCorrectLevel,this.dataList)),this.mapData(this.dataCache,c)},setupPositionProbePattern:function(a,b){for(var c=-1;7>=c;c++)if(!(-1>=a+c||this.moduleCount<=a+c))for(var d=-1;7>=d;d++)-1>=b+d||this.moduleCount<=b+d||(this.modules[a+c][b+d]=c>=0&&6>=c&&(0==d||6==d)||d>=0&&6>=d&&(0==c||6==c)||c>=2&&4>=c&&d>=2&&4>=d?!0:!1)},getBestMaskPattern:function(){for(var a=0,b=0,c=0;8>c;c++){this.makeImpl(!0,c);var d=f.getLostPoint(this);(0==c||a>d)&&(a=d,b=c)}return b},createMovieClip:function(a,b,c){var d=a.createEmptyMovieClip(b,c),e=1;this.make();for(var f=0;f<this.modules.length;f++)for(var g=f*e,h=0;h<this.modules[f].length;h++){var i=h*e,j=this.modules[f][h];j&&(d.beginFill(0,100),d.moveTo(i,g),d.lineTo(i+e,g),d.lineTo(i+e,g+e),d.lineTo(i,g+e),d.endFill())}return d},setupTimingPattern:function(){for(var a=8;a<this.moduleCount-8;a++)null==this.modules[a][6]&&(this.modules[a][6]=0==a%2);for(var b=8;b<this.moduleCount-8;b++)null==this.modules[6][b]&&(this.modules[6][b]=0==b%2)},setupPositionAdjustPattern:function(){for(var a=f.getPatternPosition(this.typeNumber),b=0;b<a.length;b++)for(var c=0;c<a.length;c++){var d=a[b],e=a[c];if(null==this.modules[d][e])for(var g=-2;2>=g;g++)for(var h=-2;2>=h;h++)this.modules[d+g][e+h]=-2==g||2==g||-2==h||2==h||0==g&&0==h?!0:!1}},setupTypeNumber:function(a){for(var b=f.getBCHTypeNumber(this.typeNumber),c=0;18>c;c++){var d=!a&&1==(1&b>>c);this.modules[Math.floor(c/3)][c%3+this.moduleCount-8-3]=d}for(var c=0;18>c;c++){var d=!a&&1==(1&b>>c);this.modules[c%3+this.moduleCount-8-3][Math.floor(c/3)]=d}},setupTypeInfo:function(a,b){for(var c=this.errorCorrectLevel<<3|b,d=f.getBCHTypeInfo(c),e=0;15>e;e++){var g=!a&&1==(1&d>>e);6>e?this.modules[e][8]=g:8>e?this.modules[e+1][8]=g:this.modules[this.moduleCount-15+e][8]=g}for(var e=0;15>e;e++){var g=!a&&1==(1&d>>e);8>e?this.modules[8][this.moduleCount-e-1]=g:9>e?this.modules[8][15-e-1+1]=g:this.modules[8][15-e-1]=g}this.modules[this.moduleCount-8][8]=!a},mapData:function(a,b){for(var c=-1,d=this.moduleCount-1,e=7,g=0,h=this.moduleCount-1;h>0;h-=2)for(6==h&&h--;;){for(var i=0;2>i;i++)if(null==this.modules[d][h-i]){var j=!1;g<a.length&&(j=1==(1&a[g]>>>e));var k=f.getMask(b,d,h-i);k&&(j=!j),this.modules[d][h-i]=j,e--,-1==e&&(g++,e=7)}if(d+=c,0>d||this.moduleCount<=d){d-=c,c=-c;break}}}},b.PAD0=236,b.PAD1=17,b.createData=function(a,c,d){for(var e=j.getRSBlocks(a,c),g=new k,h=0;h<d.length;h++){var i=d[h];g.put(i.mode,4),g.put(i.getLength(),f.getLengthInBits(i.mode,a)),i.write(g)}for(var l=0,h=0;h<e.length;h++)l+=e[h].dataCount;if(g.getLengthInBits()>8*l)throw new Error("code length overflow. ("+g.getLengthInBits()+">"+8*l+")");for(g.getLengthInBits()+4<=8*l&&g.put(0,4);0!=g.getLengthInBits()%8;)g.putBit(!1);for(;;){if(g.getLengthInBits()>=8*l)break;if(g.put(b.PAD0,8),g.getLengthInBits()>=8*l)break;g.put(b.PAD1,8)}return b.createBytes(g,e)},b.createBytes=function(a,b){for(var c=0,d=0,e=0,g=new Array(b.length),h=new Array(b.length),j=0;j<b.length;j++){var k=b[j].dataCount,l=b[j].totalCount-k;d=Math.max(d,k),e=Math.max(e,l),g[j]=new Array(k);for(var m=0;m<g[j].length;m++)g[j][m]=255&a.buffer[m+c];c+=k;var n=f.getErrorCorrectPolynomial(l),o=new i(g[j],n.getLength()-1),p=o.mod(n);h[j]=new Array(n.getLength()-1);for(var m=0;m<h[j].length;m++){var q=m+p.getLength()-h[j].length;h[j][m]=q>=0?p.get(q):0}}for(var r=0,m=0;m<b.length;m++)r+=b[m].totalCount;for(var s=new Array(r),t=0,m=0;d>m;m++)for(var j=0;j<b.length;j++)m<g[j].length&&(s[t++]=g[j][m]);for(var m=0;e>m;m++)for(var j=0;j<b.length;j++)m<h[j].length&&(s[t++]=h[j][m]);return s};for(var c={MODE_NUMBER:1,MODE_ALPHA_NUM:2,MODE_8BIT_BYTE:4,MODE_KANJI:8},d={L:1,M:0,Q:3,H:2},e={PATTERN000:0,PATTERN001:1,PATTERN010:2,PATTERN011:3,PATTERN100:4,PATTERN101:5,PATTERN110:6,PATTERN111:7},f={PATTERN_POSITION_TABLE:[[],[6,18],[6,22],[6,26],[6,30],[6,34],[6,22,38],[6,24,42],[6,26,46],[6,28,50],[6,30,54],[6,32,58],[6,34,62],[6,26,46,66],[6,26,48,70],[6,26,50,74],[6,30,54,78],[6,30,56,82],[6,30,58,86],[6,34,62,90],[6,28,50,72,94],[6,26,50,74,98],[6,30,54,78,102],[6,28,54,80,106],[6,32,58,84,110],[6,30,58,86,114],[6,34,62,90,118],[6,26,50,74,98,122],[6,30,54,78,102,126],[6,26,52,78,104,130],[6,30,56,82,108,134],[6,34,60,86,112,138],[6,30,58,86,114,142],[6,34,62,90,118,146],[6,30,54,78,102,126,150],[6,24,50,76,102,128,154],[6,28,54,80,106,132,158],[6,32,58,84,110,136,162],[6,26,54,82,110,138,166],[6,30,58,86,114,142,170]],G15:1335,G18:7973,G15_MASK:21522,getBCHTypeInfo:function(a){for(var b=a<<10;f.getBCHDigit(b)-f.getBCHDigit(f.G15)>=0;)b^=f.G15<<f.getBCHDigit(b)-f.getBCHDigit(f.G15);return(a<<10|b)^f.G15_MASK},getBCHTypeNumber:function(a){for(var b=a<<12;f.getBCHDigit(b)-f.getBCHDigit(f.G18)>=0;)b^=f.G18<<f.getBCHDigit(b)-f.getBCHDigit(f.G18);return a<<12|b},getBCHDigit:function(a){for(var b=0;0!=a;)b++,a>>>=1;return b},getPatternPosition:function(a){return f.PATTERN_POSITION_TABLE[a-1]},getMask:function(a,b,c){switch(a){case e.PATTERN000:return 0==(b+c)%2;case e.PATTERN001:return 0==b%2;case e.PATTERN010:return 0==c%3;case e.PATTERN011:return 0==(b+c)%3;case e.PATTERN100:return 0==(Math.floor(b/2)+Math.floor(c/3))%2;case e.PATTERN101:return 0==b*c%2+b*c%3;case e.PATTERN110:return 0==(b*c%2+b*c%3)%2;case e.PATTERN111:return 0==(b*c%3+(b+c)%2)%2;default:throw new Error("bad maskPattern:"+a)}},getErrorCorrectPolynomial:function(a){for(var b=new i([1],0),c=0;a>c;c++)b=b.multiply(new i([1,g.gexp(c)],0));return b},getLengthInBits:function(a,b){if(b>=1&&10>b)switch(a){case c.MODE_NUMBER:return 10;case c.MODE_ALPHA_NUM:return 9;case c.MODE_8BIT_BYTE:return 8;case c.MODE_KANJI:return 8;default:throw new Error("mode:"+a)}else if(27>b)switch(a){case c.MODE_NUMBER:return 12;case c.MODE_ALPHA_NUM:return 11;case c.MODE_8BIT_BYTE:return 16;case c.MODE_KANJI:return 10;default:throw new Error("mode:"+a)}else{if(!(41>b))throw new Error("type:"+b);switch(a){case c.MODE_NUMBER:return 14;case c.MODE_ALPHA_NUM:return 13;case c.MODE_8BIT_BYTE:return 16;case c.MODE_KANJI:return 12;default:throw new Error("mode:"+a)}}},getLostPoint:function(a){for(var b=a.getModuleCount(),c=0,d=0;b>d;d++)for(var e=0;b>e;e++){for(var f=0,g=a.isDark(d,e),h=-1;1>=h;h++)if(!(0>d+h||d+h>=b))for(var i=-1;1>=i;i++)0>e+i||e+i>=b||(0!=h||0!=i)&&g==a.isDark(d+h,e+i)&&f++;f>5&&(c+=3+f-5)}for(var d=0;b-1>d;d++)for(var e=0;b-1>e;e++){var j=0;a.isDark(d,e)&&j++,a.isDark(d+1,e)&&j++,a.isDark(d,e+1)&&j++,a.isDark(d+1,e+1)&&j++,(0==j||4==j)&&(c+=3)}for(var d=0;b>d;d++)for(var e=0;b-6>e;e++)a.isDark(d,e)&&!a.isDark(d,e+1)&&a.isDark(d,e+2)&&a.isDark(d,e+3)&&a.isDark(d,e+4)&&!a.isDark(d,e+5)&&a.isDark(d,e+6)&&(c+=40);for(var e=0;b>e;e++)for(var d=0;b-6>d;d++)a.isDark(d,e)&&!a.isDark(d+1,e)&&a.isDark(d+2,e)&&a.isDark(d+3,e)&&a.isDark(d+4,e)&&!a.isDark(d+5,e)&&a.isDark(d+6,e)&&(c+=40);for(var k=0,e=0;b>e;e++)for(var d=0;b>d;d++)a.isDark(d,e)&&k++;var l=Math.abs(100*k/b/b-50)/5;return c+=10*l}},g={glog:function(a){if(1>a)throw new Error("glog("+a+")");return g.LOG_TABLE[a]},gexp:function(a){for(;0>a;)a+=255;for(;a>=256;)a-=255;return g.EXP_TABLE[a]},EXP_TABLE:new Array(256),LOG_TABLE:new Array(256)},h=0;8>h;h++)g.EXP_TABLE[h]=1<<h;for(var h=8;256>h;h++)g.EXP_TABLE[h]=g.EXP_TABLE[h-4]^g.EXP_TABLE[h-5]^g.EXP_TABLE[h-6]^g.EXP_TABLE[h-8];for(var h=0;255>h;h++)g.LOG_TABLE[g.EXP_TABLE[h]]=h;i.prototype={get:function(a){return this.num[a]},getLength:function(){return this.num.length},multiply:function(a){for(var b=new Array(this.getLength()+a.getLength()-1),c=0;c<this.getLength();c++)for(var d=0;d<a.getLength();d++)b[c+d]^=g.gexp(g.glog(this.get(c))+g.glog(a.get(d)));return new i(b,0)},mod:function(a){if(this.getLength()-a.getLength()<0)return this;for(var b=g.glog(this.get(0))-g.glog(a.get(0)),c=new Array(this.getLength()),d=0;d<this.getLength();d++)c[d]=this.get(d);for(var d=0;d<a.getLength();d++)c[d]^=g.gexp(g.glog(a.get(d))+b);return new i(c,0).mod(a)}},j.RS_BLOCK_TABLE=[[1,26,19],[1,26,16],[1,26,13],[1,26,9],[1,44,34],[1,44,28],[1,44,22],[1,44,16],[1,70,55],[1,70,44],[2,35,17],[2,35,13],[1,100,80],[2,50,32],[2,50,24],[4,25,9],[1,134,108],[2,67,43],[2,33,15,2,34,16],[2,33,11,2,34,12],[2,86,68],[4,43,27],[4,43,19],[4,43,15],[2,98,78],[4,49,31],[2,32,14,4,33,15],[4,39,13,1,40,14],[2,121,97],[2,60,38,2,61,39],[4,40,18,2,41,19],[4,40,14,2,41,15],[2,146,116],[3,58,36,2,59,37],[4,36,16,4,37,17],[4,36,12,4,37,13],[2,86,68,2,87,69],[4,69,43,1,70,44],[6,43,19,2,44,20],[6,43,15,2,44,16],[4,101,81],[1,80,50,4,81,51],[4,50,22,4,51,23],[3,36,12,8,37,13],[2,116,92,2,117,93],[6,58,36,2,59,37],[4,46,20,6,47,21],[7,42,14,4,43,15],[4,133,107],[8,59,37,1,60,38],[8,44,20,4,45,21],[12,33,11,4,34,12],[3,145,115,1,146,116],[4,64,40,5,65,41],[11,36,16,5,37,17],[11,36,12,5,37,13],[5,109,87,1,110,88],[5,65,41,5,66,42],[5,54,24,7,55,25],[11,36,12],[5,122,98,1,123,99],[7,73,45,3,74,46],[15,43,19,2,44,20],[3,45,15,13,46,16],[1,135,107,5,136,108],[10,74,46,1,75,47],[1,50,22,15,51,23],[2,42,14,17,43,15],[5,150,120,1,151,121],[9,69,43,4,70,44],[17,50,22,1,51,23],[2,42,14,19,43,15],[3,141,113,4,142,114],[3,70,44,11,71,45],[17,47,21,4,48,22],[9,39,13,16,40,14],[3,135,107,5,136,108],[3,67,41,13,68,42],[15,54,24,5,55,25],[15,43,15,10,44,16],[4,144,116,4,145,117],[17,68,42],[17,50,22,6,51,23],[19,46,16,6,47,17],[2,139,111,7,140,112],[17,74,46],[7,54,24,16,55,25],[34,37,13],[4,151,121,5,152,122],[4,75,47,14,76,48],[11,54,24,14,55,25],[16,45,15,14,46,16],[6,147,117,4,148,118],[6,73,45,14,74,46],[11,54,24,16,55,25],[30,46,16,2,47,17],[8,132,106,4,133,107],[8,75,47,13,76,48],[7,54,24,22,55,25],[22,45,15,13,46,16],[10,142,114,2,143,115],[19,74,46,4,75,47],[28,50,22,6,51,23],[33,46,16,4,47,17],[8,152,122,4,153,123],[22,73,45,3,74,46],[8,53,23,26,54,24],[12,45,15,28,46,16],[3,147,117,10,148,118],[3,73,45,23,74,46],[4,54,24,31,55,25],[11,45,15,31,46,16],[7,146,116,7,147,117],[21,73,45,7,74,46],[1,53,23,37,54,24],[19,45,15,26,46,16],[5,145,115,10,146,116],[19,75,47,10,76,48],[15,54,24,25,55,25],[23,45,15,25,46,16],[13,145,115,3,146,116],[2,74,46,29,75,47],[42,54,24,1,55,25],[23,45,15,28,46,16],[17,145,115],[10,74,46,23,75,47],[10,54,24,35,55,25],[19,45,15,35,46,16],[17,145,115,1,146,116],[14,74,46,21,75,47],[29,54,24,19,55,25],[11,45,15,46,46,16],[13,145,115,6,146,116],[14,74,46,23,75,47],[44,54,24,7,55,25],[59,46,16,1,47,17],[12,151,121,7,152,122],[12,75,47,26,76,48],[39,54,24,14,55,25],[22,45,15,41,46,16],[6,151,121,14,152,122],[6,75,47,34,76,48],[46,54,24,10,55,25],[2,45,15,64,46,16],[17,152,122,4,153,123],[29,74,46,14,75,47],[49,54,24,10,55,25],[24,45,15,46,46,16],[4,152,122,18,153,123],[13,74,46,32,75,47],[48,54,24,14,55,25],[42,45,15,32,46,16],[20,147,117,4,148,118],[40,75,47,7,76,48],[43,54,24,22,55,25],[10,45,15,67,46,16],[19,148,118,6,149,119],[18,75,47,31,76,48],[34,54,24,34,55,25],[20,45,15,61,46,16]],j.getRSBlocks=function(a,b){var c=j.getRsBlockTable(a,b);if(void 0==c)throw new Error("bad rs block @ typeNumber:"+a+"/errorCorrectLevel:"+b);for(var d=c.length/3,e=[],f=0;d>f;f++)for(var g=c[3*f+0],h=c[3*f+1],i=c[3*f+2],k=0;g>k;k++)e.push(new j(h,i));return e},j.getRsBlockTable=function(a,b){switch(b){case d.L:return j.RS_BLOCK_TABLE[4*(a-1)+0];case d.M:return j.RS_BLOCK_TABLE[4*(a-1)+1];case d.Q:return j.RS_BLOCK_TABLE[4*(a-1)+2];case d.H:return j.RS_BLOCK_TABLE[4*(a-1)+3];default:return void 0}},k.prototype={get:function(a){var b=Math.floor(a/8);return 1==(1&this.buffer[b]>>>7-a%8)},put:function(a,b){for(var c=0;b>c;c++)this.putBit(1==(1&a>>>b-c-1))},getLengthInBits:function(){return this.length},putBit:function(a){var b=Math.floor(this.length/8);this.buffer.length<=b&&this.buffer.push(0),a&&(this.buffer[b]|=128>>>this.length%8),this.length++}};var l=[[17,14,11,7],[32,26,20,14],[53,42,32,24],[78,62,46,34],[106,84,60,44],[134,106,74,58],[154,122,86,64],[192,152,108,84],[230,180,130,98],[271,213,151,119],[321,251,177,137],[367,287,203,155],[425,331,241,177],[458,362,258,194],[520,412,292,220],[586,450,322,250],[644,504,364,280],[718,560,394,310],[792,624,442,338],[858,666,482,382],[929,711,509,403],[1003,779,565,439],[1091,857,611,461],[1171,911,661,511],[1273,997,715,535],[1367,1059,751,593],[1465,1125,805,625],[1528,1190,868,658],[1628,1264,908,698],[1732,1370,982,742],[1840,1452,1030,790],[1952,1538,1112,842],[2068,1628,1168,898],[2188,1722,1228,958],[2303,1809,1283,983],[2431,1911,1351,1051],[2563,1989,1423,1093],[2699,2099,1499,1139],[2809,2213,1579,1219],[2953,2331,1663,1273]],o=function(){var a=function(a,b){this._el=a,this._htOption=b};return a.prototype.draw=function(a){function g(a,b){var c=document.createElementNS("http://www.w3.org/2000/svg",a);for(var d in b)b.hasOwnProperty(d)&&c.setAttribute(d,b[d]);return c}var b=this._htOption,c=this._el,d=a.getModuleCount();Math.floor(b.width/d),Math.floor(b.height/d),this.clear();var h=g("svg",{viewBox:"0 0 "+String(d)+" "+String(d),width:"100%",height:"100%",fill:b.colorLight});h.setAttributeNS("http://www.w3.org/2000/xmlns/","xmlns:xlink","http://www.w3.org/1999/xlink"),c.appendChild(h),h.appendChild(g("rect",{fill:b.colorDark,width:"1",height:"1",id:"template"}));for(var i=0;d>i;i++)for(var j=0;d>j;j++)if(a.isDark(i,j)){var k=g("use",{x:String(i),y:String(j)});k.setAttributeNS("http://www.w3.org/1999/xlink","href","#template"),h.appendChild(k)}},a.prototype.clear=function(){for(;this._el.hasChildNodes();)this._el.removeChild(this._el.lastChild)},a}(),p="svg"===document.documentElement.tagName.toLowerCase(),q=p?o:m()?function(){function a(){this._elImage.src=this._elCanvas.toDataURL("image/png"),this._elImage.style.display="block",this._elCanvas.style.display="none"}function d(a,b){var c=this;if(c._fFail=b,c._fSuccess=a,null===c._bSupportDataURI){var d=document.createElement("img"),e=function(){c._bSupportDataURI=!1,c._fFail&&_fFail.call(c)},f=function(){c._bSupportDataURI=!0,c._fSuccess&&c._fSuccess.call(c)};return d.onabort=e,d.onerror=e,d.onload=f,d.src="data:image/gif;base64,iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFCAYAAACNbyblAAAAHElEQVQI12P4//8/w38GIAXDIBKE0DHxgljNBAAO9TXL0Y4OHwAAAABJRU5ErkJggg==",void 0}c._bSupportDataURI===!0&&c._fSuccess?c._fSuccess.call(c):c._bSupportDataURI===!1&&c._fFail&&c._fFail.call(c)}if(this._android&&this._android<=2.1){var b=1/window.devicePixelRatio,c=CanvasRenderingContext2D.prototype.drawImage;CanvasRenderingContext2D.prototype.drawImage=function(a,d,e,f,g,h,i,j){if("nodeName"in a&&/img/i.test(a.nodeName))for(var l=arguments.length-1;l>=1;l--)arguments[l]=arguments[l]*b;else"undefined"==typeof j&&(arguments[1]*=b,arguments[2]*=b,arguments[3]*=b,arguments[4]*=b);c.apply(this,arguments)}}var e=function(a,b){this._bIsPainted=!1,this._android=n(),this._htOption=b,this._elCanvas=document.createElement("canvas"),this._elCanvas.width=b.width,this._elCanvas.height=b.height,a.appendChild(this._elCanvas),this._el=a,this._oContext=this._elCanvas.getContext("2d"),this._bIsPainted=!1,this._elImage=document.createElement("img"),this._elImage.style.display="none",this._el.appendChild(this._elImage),this._bSupportDataURI=null};return e.prototype.draw=function(a){var b=this._elImage,c=this._oContext,d=this._htOption,e=a.getModuleCount(),f=d.width/e,g=d.height/e,h=Math.round(f),i=Math.round(g);b.style.display="none",this.clear();for(var j=0;e>j;j++)for(var k=0;e>k;k++){var l=a.isDark(j,k),m=k*f,n=j*g;c.strokeStyle=l?d.colorDark:d.colorLight,c.lineWidth=1,c.fillStyle=l?d.colorDark:d.colorLight,c.fillRect(m,n,f,g),c.strokeRect(Math.floor(m)+.5,Math.floor(n)+.5,h,i),c.strokeRect(Math.ceil(m)-.5,Math.ceil(n)-.5,h,i)}this._bIsPainted=!0},e.prototype.makeImage=function(){this._bIsPainted&&d.call(this,a)},e.prototype.isPainted=function(){return this._bIsPainted},e.prototype.clear=function(){this._oContext.clearRect(0,0,this._elCanvas.width,this._elCanvas.height),this._bIsPainted=!1},e.prototype.round=function(a){return a?Math.floor(1e3*a)/1e3:a},e}():function(){var a=function(a,b){this._el=a,this._htOption=b};return a.prototype.draw=function(a){for(var b=this._htOption,c=this._el,d=a.getModuleCount(),e=Math.floor(b.width/d),f=Math.floor(b.height/d),g=['<table style="border:0;border-collapse:collapse;">'],h=0;d>h;h++){g.push("<tr>");for(var i=0;d>i;i++)g.push('<td style="border:0;border-collapse:collapse;padding:0;margin:0;width:'+e+"px;height:"+f+"px;background-color:"+(a.isDark(h,i)?b.colorDark:b.colorLight)+';"></td>');g.push("</tr>")}g.push("</table>"),c.innerHTML=g.join("");var j=c.childNodes[0],k=(b.width-j.offsetWidth)/2,l=(b.height-j.offsetHeight)/2;k>0&&l>0&&(j.style.margin=l+"px "+k+"px")},a.prototype.clear=function(){this._el.innerHTML=""},a}();QRCode=function(a,b){if(this._htOption={width:256,height:256,typeNumber:4,colorDark:"#000000",colorLight:"#ffffff",correctLevel:d.H},"string"==typeof b&&(b={text:b}),b)for(var c in b)this._htOption[c]=b[c];"string"==typeof a&&(a=document.getElementById(a)),this._android=n(),this._el=a,this._oQRCode=null,this._oDrawing=new q(this._el,this._htOption),this._htOption.text&&this.makeCode(this._htOption.text)},QRCode.prototype.makeCode=function(a){this._oQRCode=new b(r(a,this._htOption.correctLevel),this._htOption.correctLevel),this._oQRCode.addData(a),this._oQRCode.make(),this._el.title=a,this._oDrawing.draw(this._oQRCode),this.makeImage()},QRCode.prototype.makeImage=function(){"function"==typeof this._oDrawing.makeImage&&(!this._android||this._android>=3)&&this._oDrawing.makeImage()},QRCode.prototype.clear=function(){this._oDrawing.clear()},QRCode.CorrectLevel=d}();`;
export const VENDOR_QRCODEJS_JS_HASH = "c541ef063278";

export const NFC_JS = `// nfc.js — classic script (no import/export)

function browserSupportsNfc() {
  return 'NDEFReader' in window;
}

async function getNfcPermissionState() {
  if (!browserSupportsNfc()) return 'unsupported';
  try {
    var result = await navigator.permissions.query({ name: 'nfc' });
    return result.state;
  } catch (e) {
    return 'prompt';
  }
}

async function canAutoStartNfc() {
  return (await getNfcPermissionState()) === 'granted';
}

function normalizeNfcSerial(serialNumber) {
  return serialNumber ? serialNumber.replace(/:/g, '').toLowerCase() : '';
}

async function extractNdefUrl(records, prefixes) {
  var acceptedPrefixes = prefixes || ['lnurlw://', 'lnurlp://', 'https://'];
  var decoder = new TextDecoder();

  function bytesFromRecordData(data) {
    if (!data) return new Uint8Array();
    if (data instanceof DataView) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    return new Uint8Array();
  }

  function decodeUriRecord(data) {
    var bytes = bytesFromRecordData(data);
    if (!bytes.length) return '';
    var uriPrefixes = ['', 'http://www.', 'https://www.', 'http://', 'https://', 'tel:', 'mailto:', 'ftp://anonymous:anonymous@', 'ftp://ftp.', 'ftps://', 'sftp://', 'smb://', 'nfs://', 'ftp://', 'dav://', 'news:', 'telnet://', 'imap:', 'rtsp://', 'urn:', 'pop:', 'sip:', 'sips:', 'tftp:', 'btspp://', 'btl2cap://', 'btgoep://', 'tcpobex://', 'irdaobex://', 'file://', 'urn:epc:id:', 'urn:epc:tag:', 'urn:epc:pat:', 'urn:epc:raw:', 'urn:epc:', 'urn:nfc:'];
    var prefix = uriPrefixes[bytes[0]];
    if (prefix !== undefined) {
      return prefix + decoder.decode(bytes.slice(1));
    }
    return decoder.decode(bytes);
  }

  function decodeTextRecord(data) {
    var bytes = bytesFromRecordData(data);
    if (!bytes.length) return '';
    var direct = decoder.decode(bytes);
    var langLength = bytes[0] & 0x3f;
    if (bytes.length > langLength + 1) {
      var payload = decoder.decode(bytes.slice(langLength + 1));
      if (payload.indexOf('://') !== -1) return payload;
    }
    return direct;
  }

  for (var i = 0; i < records.length; i++) {
    var record = records[i];
    if (record.recordType !== 'url' && record.recordType !== 'absolute-url' && record.recordType !== 'text') {
      continue;
    }
    var text = record.recordType === 'absolute-url'
      ? record.id || await new Response(record.data).text()
      : record.recordType === 'url'
        ? decodeUriRecord(record.data)
        : decodeTextRecord(record.data);
    var lower = text.toLowerCase();
    for (var j = 0; j < acceptedPrefixes.length; j++) {
      if (lower.startsWith(acceptedPrefixes[j])) {
        return text;
      }
    }
  }
  if (typeof window.reportClientError === 'function') {
    var summary = records.map(function(r) { return r.recordType + ':' + (r.mediaType || ''); }).join(', ');
    window.reportClientError(new Error('NDEF URL extraction failed: ' + summary + ' (prefixes: ' + acceptedPrefixes.join(',') + ')'), 'nfc.js:extractNdefUrl');
  }
  return '';
}

function normalizeBrowserNfcUrl(rawUrl) {
  if (!rawUrl) return '';
  if (rawUrl.startsWith('lnurlw://') || rawUrl.startsWith('lnurlp://')) {
    return 'https://' + rawUrl.substring(rawUrl.indexOf('://') + 3);
  }
  return rawUrl.replace(/^http:\\/\\//i, 'https://');
}

function createNfcScanner(opts) {
  window._nfcPageHandler = true;
  if (window._nfcGateAbort) { window._nfcGateAbort.abort(); window._nfcGateAbort = null; }
  var abortCtrl = null;
  var _active = false;
  var lastReadTime = 0;
  var o = Object.assign({
    onTap: null,
    onError: null,
    onStatus: null,
    prefixes: ['lnurlw://', 'lnurlp://', 'https://'],
    continuous: true,
    debounceMs: 1500
  }, opts || {});

  async function scan() {
    if (!browserSupportsNfc()) {
      if (o.onError) o.onError(new Error('Web NFC not supported'), 'permission');
      return;
    }
    if (abortCtrl) abortCtrl.abort();
    abortCtrl = new AbortController();
    if (o.onStatus) o.onStatus('starting');
    try {
      var ndef = new NDEFReader();
      await ndef.scan({ signal: abortCtrl.signal });
      _active = true;
      if (o.onStatus) o.onStatus('scanning');
      ndef.onreadingerror = function() {
        if (o.onError) o.onError(new Error('NFC read failed'), 'scan');
      };
      ndef.onreading = async function(event) {
        var now = Date.now();
        if (o.debounceMs > 0 && now - lastReadTime < o.debounceMs) return;
        lastReadTime = now;
        var serial = normalizeNfcSerial(event.serialNumber);
        var url = await extractNdefUrl(event.message.records, o.prefixes);
        url = normalizeBrowserNfcUrl(url);
        if (!o.continuous && _active) stop();
        if (o.onTap) {
          try { await o.onTap({ url: url, serial: serial, records: event.message.records, event: event }); }
          catch (e) { if (o.onError) o.onError(e, 'parse'); }
        }
      };
    } catch (error) {
      _active = false;
      if (error.name === 'AbortError') {
        if (o.onStatus) o.onStatus('stopped');
      } else {
        var phase = (error.name === 'NotAllowedError' || error.name === 'NotSupportedError') ? 'permission' : 'scan';
        if (o.onError) o.onError(error, phase);
        if (o.onStatus) o.onStatus('stopped');
      }
    }
  }

  function stop() {
    if (abortCtrl) { abortCtrl.abort(); abortCtrl = null; }
    _active = false;
    if (o.onStatus) o.onStatus('stopped');
  }

  function restart() {
    stop();
    setTimeout(function() { scan(); }, 200);
  }

  function isActive() { return _active; }

  return { scan: scan, stop: stop, restart: restart, isActive: isActive };
}

function stateLabel(state) {
  var labels = {
    'new': 'New',
    'pending': 'Pending',
    'discovered': 'Discovered',
    'keys_delivered': 'Keys Delivered',
    'active': 'Active',
    'wipe_requested': 'Wipe Requested',
    'terminated': 'Terminated',
    'legacy': 'Legacy',
  };
  return labels[state] || state;
}

function stateColor(state) {
  var colors = {
    'active': 'text-emerald-400',
    'discovered': 'text-blue-400',
    'pending': 'text-yellow-400',
    'keys_delivered': 'text-cyan-400',
    'terminated': 'text-red-400',
    'wipe_requested': 'text-orange-400',
    'new': 'text-gray-400',
    'legacy': 'text-gray-500',
  };
  return colors[state] || 'text-gray-300';
}

function provenanceLabel(p, short) {
  var full = {
    'public_issuer': 'Public Key',
    'env_issuer': 'Private (Server)',
    'percard': 'Per-Card Import',
    'user_provisioned': 'User Provisioned',
    'unknown': 'Unknown',
  };
  var abbr = {
    'public_issuer': 'Public',
    'env_issuer': 'Private',
    'percard': 'Per-Card',
    'user_provisioned': 'User',
    'unknown': 'Unknown',
  };
  return short ? (abbr[p] || p || '-') : (full[p] || p || 'Unknown');
}

function provenanceColor(p) {
  if (p === 'public_issuer') return 'text-yellow-400';
  if (p === 'env_issuer') return 'text-emerald-400';
  return 'text-gray-300';
}`;
export const NFC_JS_HASH = "8252340a6425";

export const NFC_GATE_JS = `// nfc-gate.js — passive NFC capture to prevent Android OS from intercepting taps
(function() {
  if (!('NDEFReader' in window)) return;
  window._nfcGateAbort = null;
  window._nfcPageHandler = !!window._nfcPageHandler;
  function startGate() {
    if (window._nfcPageHandler) return;
    if (window._nfcGateAbort) window._nfcGateAbort.abort();
    var ctrl = new AbortController();
    window._nfcGateAbort = ctrl;
    var ndef = new NDEFReader();
    ndef.scan({ signal: ctrl.signal }).then(function() {
      if (ctrl.signal.aborted) return;
      ndef.onreading = function(event) {
        if (window._nfcPageHandler) return;
        if (typeof extractNdefUrl === 'function') {
          extractNdefUrl(event.message.records, ['lnurlw://', 'lnurlp://', 'https://']).then(function(url) {
            navigateToCardUrl(url);
          }).catch(function() {});
        } else {
          navigateToCardUrl(extractFallbackUrl(event.message.records));
        }
      };
    }).catch(function() {});
  }
  function bytesFromRecordData(data) {
    if (!data) return new Uint8Array();
    if (data instanceof DataView) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    return new Uint8Array();
  }
  function decodeUriRecord(data) {
    var bytes = bytesFromRecordData(data);
    if (!bytes.length) return '';
    var prefixes = ['', 'http://www.', 'https://www.', 'http://', 'https://', 'tel:', 'mailto:', 'ftp://anonymous:anonymous@', 'ftp://ftp.', 'ftps://', 'sftp://', 'smb://', 'nfs://', 'ftp://', 'dav://', 'news:', 'telnet://', 'imap:', 'rtsp://', 'urn:', 'pop:', 'sip:', 'sips:', 'tftp:', 'btspp://', 'btl2cap://', 'btgoep://', 'tcpobex://', 'irdaobex://', 'file://', 'urn:epc:id:', 'urn:epc:tag:', 'urn:epc:pat:', 'urn:epc:raw:', 'urn:epc:', 'urn:nfc:'];
    var prefix = prefixes[bytes[0]];
    var decoder = new TextDecoder();
    return (prefix === undefined ? '' : prefix) + decoder.decode(bytes.slice(prefix === undefined ? 0 : 1));
  }
  function extractFallbackUrl(records) {
    var decoder = new TextDecoder();
    for (var i = 0; i < records.length; i++) {
      var r = records[i];
      if (r.recordType === 'url') return decodeUriRecord(r.data);
      if (r.recordType === 'absolute-url') return r.id || decoder.decode(bytesFromRecordData(r.data));
      if (r.recordType === 'text') {
        var bytes = bytesFromRecordData(r.data);
        var langLength = bytes.length ? bytes[0] & 0x3f : 0;
        var text = bytes.length > langLength + 1 ? decoder.decode(bytes.slice(langLength + 1)) : decoder.decode(bytes);
        if (text.indexOf('://') !== -1) return text;
      }
    }
    return '';
  }
  function navigateToCardUrl(rawUrl) {
    if (!rawUrl) return;
    var url = rawUrl;
    if (url.toLowerCase().startsWith('lnurlw://') || url.toLowerCase().startsWith('lnurlp://')) {
      url = 'https://' + url.substring(url.indexOf('://') + 3);
    } else if (url.toLowerCase().startsWith('http://')) {
      url = url.replace(/^http:\\/\\//i, 'https://');
    }
    try {
      var u = new URL(url, location.origin);
      if (u.origin === location.origin && u.pathname === '/' && u.searchParams.has('p') && u.searchParams.has('c')) {
        location.href = u.href;
      }
    } catch(e) {}
  }
  startGate();
})();`;
export const NFC_GATE_JS_HASH = "79dfa4f2cda9";

export const VIRTUAL_CARD_SIM_JS = `(function() {
  var VC_KEY = 'virtual_boltcard';
  var AES_JS_URL = 'https://cdn.jsdelivr.net/npm/aes-js@3.1.2/index.js';

  function loadVC() {
    try {
      var raw = localStorage.getItem(VC_KEY);
      if (!raw) return null;
      var data = JSON.parse(raw);
      if (data && data.uid && data.k1 && data.k2 && typeof data.counter === 'number') return data;
    } catch (e) {}
    return null;
  }

  function saveVC(card) {
    try { localStorage.setItem(VC_KEY, JSON.stringify(card)); } catch (e) {}
  }

  function clearVC() {
    try { localStorage.removeItem(VC_KEY); } catch (e) {}
  }

  var virtualCard = loadVC();
  if (!virtualCard) {
    window._virtualSim = { isActive: function() { return false; } };
    window._vcTap = function() { return null; };
    window._vcGetKeys = function() { return null; };
    if (!('NDEFReader' in window)) {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', addCreateCardFab);
      } else {
        addCreateCardFab();
      }
    }
    return;
  }

  var mockReaders = [];

  function MockNDEFReader() {
    this.onreading = null;
    this.onreadingerror = null;
    this._signal = null;
    this._active = false;
  }

  MockNDEFReader.prototype.scan = function(options) {
    var self = this;
    var signal = options && options.signal ? options.signal : null;
    self._signal = signal;
    return new Promise(function(resolve, reject) {
      if (signal && signal.aborted) {
        var err = new Error('The operation was aborted.');
        err.name = 'AbortError';
        reject(err);
        return;
      }
      self._active = true;
      mockReaders.push(self);
      if (signal) {
        signal.addEventListener('abort', function() {
          self._active = false;
          var idx = mockReaders.indexOf(self);
          if (idx !== -1) mockReaders.splice(idx, 1);
        });
      }
      resolve();
    });
  };

  window.NDEFReader = MockNDEFReader;

  if (navigator.permissions && navigator.permissions.query) {
    var originalQuery = navigator.permissions.query.bind(navigator.permissions);
    navigator.permissions.query = function(desc) {
      if (desc && desc.name === 'nfc') {
        return Promise.resolve({ state: 'granted', onchange: null });
      }
      return originalQuery(desc);
    };
  }

  var URI_PREFIX_TABLE = [
    '', 'http://www.', 'https://www.', 'http://', 'https://',
    'tel:', 'mailto:', 'ftp://anonymous:anonymous@', 'ftp://ftp.',
    'ftps://', 'sftp://', 'smb://', 'nfs://', 'ftp://', 'dav://',
    'news:', 'telnet://', 'imap:', 'rtsp://', 'urn:', 'pop:',
    'sip:', 'sips:', 'tftp:', 'btspp://', 'btl2cap://', 'btgoep://',
    'tcpobex://', 'irdaobex://', 'file://', 'urn:epc:id:',
    'urn:epc:tag:', 'urn:epc:pat:', 'urn:epc:raw:', 'urn:epc:', 'urn:nfc:'
  ];

  function encodeNdefUrlRecord(url) {
    var prefixCode = -1;
    for (var i = 0; i < URI_PREFIX_TABLE.length; i++) {
      if (url.indexOf(URI_PREFIX_TABLE[i]) === 0) {
        prefixCode = i;
        break;
      }
    }
    var encoder = new TextEncoder();
    var payload;
    if (prefixCode >= 0) {
      var remainder = url.substring(URI_PREFIX_TABLE[prefixCode].length);
      var body = encoder.encode(remainder);
      payload = new Uint8Array(1 + body.length);
      payload[0] = prefixCode;
      payload.set(body, 1);
    } else {
      payload = encoder.encode(url);
    }
    return payload.buffer;
  }

  function hexToBytes(hex) {
    var bytes = new Uint8Array(hex.length / 2);
    for (var i = 0; i < hex.length; i += 2) {
      bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
    }
    return bytes;
  }

  function bytesToHex(bytes) {
    var hex = [];
    for (var i = 0; i < bytes.length; i++) {
      hex.push((bytes[i] & 0xff).toString(16).padStart(2, '0'));
    }
    return hex.join('');
  }

  function aesEcbEncrypt(key, plaintext) {
    var aes = new aesjs.ModeOfOperation.ecb(key);
    return new Uint8Array(aes.encrypt(plaintext));
  }

  function xorArrays(a, b) {
    var result = new Uint8Array(a.length);
    for (var i = 0; i < a.length; i++) result[i] = a[i] ^ b[i];
    return result;
  }

  function shiftLeft(src) {
    var shifted = new Uint8Array(src.length);
    var carry = 0;
    for (var i = src.length - 1; i >= 0; i--) {
      var msb = src[i] >> 7;
      shifted[i] = ((src[i] << 1) & 0xff) | carry;
      carry = msb;
    }
    return { shifted: shifted, carry: carry };
  }

  function generateSubkey(input) {
    var result = shiftLeft(input);
    var subkey = new Uint8Array(result.shifted);
    if (result.carry) subkey[subkey.length - 1] ^= 0x87;
    return subkey;
  }

  function computeAesCmac(message, key) {
    var zeroBlock = new Uint8Array(16);
    var L = aesEcbEncrypt(key, zeroBlock);
    var K1 = generateSubkey(L);
    var M_last;
    if (message.length === 16) {
      M_last = xorArrays(message, K1);
    } else {
      var padded = new Uint8Array(16);
      padded.set(message);
      padded[message.length] = 0x80;
      var K2 = generateSubkey(K1);
      M_last = xorArrays(padded, K2);
    }
    return aesEcbEncrypt(key, M_last);
  }

  function computeCm(ks) {
    var zeroBlock = new Uint8Array(16);
    var Lprime = aesEcbEncrypt(ks, zeroBlock);
    var K1prime = generateSubkey(Lprime);
    var hk1 = generateSubkey(K1prime);
    var hashVal = new Uint8Array(hk1);
    hashVal[0] ^= 0x80;
    return aesEcbEncrypt(ks, hashVal);
  }

  function buildVerificationData(uidBytes, ctr, k2Bytes) {
    var sv2 = new Uint8Array(16);
    sv2[0] = 0x3c; sv2[1] = 0xc3; sv2[2] = 0x00; sv2[3] = 0x01;
    sv2[4] = 0x00; sv2[5] = 0x80;
    sv2.set(uidBytes, 6);
    sv2[13] = ctr[2]; sv2[14] = ctr[1]; sv2[15] = ctr[0];
    var ks = computeAesCmac(sv2, k2Bytes);
    var cm = computeCm(ks);
    return new Uint8Array([cm[1], cm[3], cm[5], cm[7], cm[9], cm[11], cm[13], cm[15]]);
  }

  function virtualTap(uidHex, counter, k1Hex, k2Hex) {
    var k1 = hexToBytes(k1Hex);
    var uid = hexToBytes(uidHex);
    var plaintext = new Uint8Array(16);
    plaintext[0] = 0xc7;
    plaintext.set(uid, 1);
    plaintext[8] = counter & 0xff;
    plaintext[9] = (counter >> 8) & 0xff;
    plaintext[10] = (counter >> 16) & 0xff;
    var encrypted = aesEcbEncrypt(k1, plaintext);
    var pHex = bytesToHex(encrypted);
    var ctrBytes = new Uint8Array([
      (counter >> 16) & 0xff,
      (counter >> 8) & 0xff,
      counter & 0xff
    ]);
    var ct = buildVerificationData(uid, ctrBytes, hexToBytes(k2Hex));
    var cHex = bytesToHex(ct);
    return { p: pHex, c: cHex };
  }

  var aesJsPromise = null;
  function ensureAesJs() {
    if (window.aesjs) return Promise.resolve();
    if (aesJsPromise) return aesJsPromise;
    aesJsPromise = new Promise(function(resolve, reject) {
      var script = document.createElement('script');
      script.src = AES_JS_URL;
      script.onload = function() { resolve(); };
      script.onerror = function() {
        aesJsPromise = null;
        reject(new Error('Failed to load aes-js library'));
      };
      document.head.appendChild(script);
    });
    return aesJsPromise;
  }

  function formatSerial(uidHex) {
    return uidHex.match(/.{2}/g).join(':');
  }

  function computeTapParams() {
    return ensureAesJs().then(function() {
      var result = virtualTap(virtualCard.uid, virtualCard.counter, virtualCard.k1, virtualCard.k2);
      virtualCard.counter++;
      saveVC(virtualCard);
      updateFabLabel();
      return { p: result.p, c: result.c };
    });
  }

  function performVirtualTap() {
    return computeTapParams().then(function(params) {
      var baseUrl = window.location.origin;
      var tapUrl = baseUrl + '/?p=' + encodeURIComponent(params.p) + '&c=' + encodeURIComponent(params.c);
      var recordData = encodeNdefUrlRecord(tapUrl);
      var event = {
        serialNumber: formatSerial(virtualCard.uid),
        message: { records: [{ recordType: 'url', mediaType: '', id: '', data: recordData }] }
      };

      var readers = mockReaders.slice();
      var fired = 0;
      for (var i = 0; i < readers.length; i++) {
        var reader = readers[i];
        if (reader._active && typeof reader.onreading === 'function') {
          try { reader.onreading(event); fired++; } catch (e) {}
        }
      }

      if (fired === 0) {
        if (typeof window._vcTapCredential === 'function') {
          window._vcTapCredential(params.p, params.c);
        } else if (typeof window._vcTapPair === 'function') {
          window._vcTapPair(params.p, params.c);
        } else if (!window._nfcPageHandler) {
          navigateToTapUrl(tapUrl);
        }
      }
      return { fired: fired, url: tapUrl };
    });
  }

  function navigateToTapUrl(url) {
    try {
      var u = new URL(url, location.origin);
      if (u.origin === location.origin && u.searchParams.has('p') && u.searchParams.has('c')) {
        location.href = u.href;
      }
    } catch (e) {}
  }

  var fab = null;
  function updateFabLabel() {
    if (!fab) return;
    var label = fab.querySelector('.vc-fab-label');
    if (label) {
      label.textContent = 'Virtual Tap #' + virtualCard.counter + ' (' + virtualCard.uid.substring(0, 7).toUpperCase() + '\\u2026)';
    }
  }

  function addCreateCardFab() {
    if (document.getElementById('virtual-create-fab')) return;
    if (window.location.pathname === '/virtual') return;
    var fab = document.createElement('div');
    fab.id = 'virtual-create-fab';
    fab.style.cssText = 'position:fixed;bottom:1rem;right:1rem;z-index:99998;';
    var link = document.createElement('a');
    link.href = '/virtual';
    link.style.cssText = 'display:flex;align-items:center;gap:0.5rem;background:#6366f1;color:white;text-decoration:none;padding:0.75rem 1.5rem;border-radius:9999px;font-size:0.875rem;font-weight:600;box-shadow:0 4px 6px -1px rgba(0,0,0,0.3),0 2px 4px -2px rgba(99,102,241,0.4);transition:transform 0.15s,background 0.15s;';
    link.addEventListener('mouseenter', function() { link.style.background = '#4f46e5'; link.style.transform = 'scale(1.05)'; });
    link.addEventListener('mouseleave', function() { link.style.background = '#6366f1'; link.style.transform = 'scale(1)'; });
    var icon = document.createElement('span');
    icon.textContent = '\\u{1f4cb}';
    icon.style.fontSize = '1.125rem';
    link.appendChild(icon);
    var label = document.createElement('span');
    label.textContent = 'Create Virtual Card';
    link.appendChild(label);
    fab.appendChild(link);
    document.body.appendChild(fab);
  }

  function addFloatingButton() {
    if (document.getElementById('virtual-tap-fab')) return;
    fab = document.createElement('div');
    fab.id = 'virtual-tap-fab';
    fab.style.cssText = 'position:fixed;bottom:1rem;right:1rem;z-index:99998;';
    var inner = document.createElement('button');
    inner.className = 'vc-fab-label';
    inner.style.cssText = 'display:flex;align-items:center;gap:0.5rem;background:#6366f1;color:white;border:none;padding:0.75rem 1.5rem;border-radius:9999px;font-size:0.875rem;font-weight:600;box-shadow:0 4px 6px -1px rgba(0,0,0,0.3),0 2px 4px -2px rgba(99,102,241,0.4);cursor:pointer;transition:transform 0.15s,background 0.15s;';
    inner.addEventListener('mouseenter', function() { inner.style.background = '#4f46e5'; inner.style.transform = 'scale(1.05)'; });
    inner.addEventListener('mouseleave', function() { inner.style.background = '#6366f1'; inner.style.transform = 'scale(1)'; });

    var icon = document.createElement('span');
    icon.textContent = '\\u{1f4cb}';
    icon.style.fontSize = '1.125rem';
    inner.appendChild(icon);

    var labelText = document.createElement('span');
    labelText.className = 'vc-fab-label';
    inner.appendChild(labelText);

    inner.addEventListener('click', function() {
      inner.disabled = true;
      inner.style.opacity = '0.6';
      performVirtualTap().then(function() {
        inner.disabled = false;
        inner.style.opacity = '1';
      }).catch(function(err) {
        inner.disabled = false;
        inner.style.opacity = '1';
        if (typeof window.reportClientError === 'function') {
          window.reportClientError(err, 'virtual-card-sim.js:tap');
        }
      });
    });

    fab.appendChild(inner);

    var clearLink = document.createElement('a');
    clearLink.href = '/virtual';
    clearLink.textContent = 'Manage \\u2192';
    clearLink.style.cssText = 'display:block;text-align:center;margin-top:0.25rem;font-size:0.625rem;color:#818cf8;text-decoration:none;opacity:0.7;';
    fab.appendChild(clearLink);

    document.body.appendChild(fab);
    updateFabLabel();
  }

  window._virtualSim = {
    isActive: function() { return !!virtualCard; },
    getCard: function() { return virtualCard ? { uid: virtualCard.uid, counter: virtualCard.counter, k1: virtualCard.k1, k2: virtualCard.k2 } : null; },
    tap: performVirtualTap,
    computeTap: computeTapParams,
    clear: function() { clearVC(); location.reload(); }
  };

  // _vcTap/_vcGetKeys: consumed by E2E VirtualProvider on any page (see virtual-card-widget.js)
  window._vcTap = function() {
    if (!virtualCard) return null;
    var result = virtualTap(virtualCard.uid, virtualCard.counter, virtualCard.k1, virtualCard.k2);
    var counter = virtualCard.counter;
    virtualCard.counter++;
    saveVC(virtualCard);
    return { p: result.p, c: result.c, counter: counter };
  };
  window._vcGetKeys = function() {
    return virtualCard
      ? { uid: virtualCard.uid, k1: virtualCard.k1, k2: virtualCard.k2, counter: virtualCard.counter }
      : null;
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', addFloatingButton);
  } else {
    addFloatingButton();
  }
})();`;
export const VIRTUAL_CARD_SIM_JS_HASH = "c76e99e5f58c";

export const VIRTUAL_CARD_WIDGET_JS = `// virtual-card-widget.js — unified virtual card simulator
// Consolidates crypto + UI from virtual-card.js, virtual-card-page.js, virtual-card-sim.js
// Requires: aes-js CDN (loaded by template)

(function() {
  var VC_KEY = 'virtual_boltcard';

  // ─── Crypto primitives (ported from cryptoutils.ts, single canonical copy) ───

  function hexToBytes(hex) {
    if (!hex || hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) {
      throw new Error('Invalid hex string');
    }
    var bytes = new Uint8Array(hex.length / 2);
    for (var i = 0; i < hex.length; i += 2) {
      bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
    }
    return bytes;
  }

  function bytesToHex(bytes) {
    var hex = [];
    for (var i = 0; i < bytes.length; i++) {
      hex.push((bytes[i] & 0xff).toString(16).padStart(2, '0'));
    }
    return hex.join('');
  }

  function aesEcbEncrypt(key, plaintext) {
    var aes = new aesjs.ModeOfOperation.ecb(key);
    return new Uint8Array(aes.encrypt(plaintext));
  }

  function xorArrays(a, b) {
    var result = new Uint8Array(a.length);
    for (var i = 0; i < a.length; i++) result[i] = a[i] ^ b[i];
    return result;
  }

  function shiftLeft(src) {
    var shifted = new Uint8Array(src.length);
    var carry = 0;
    for (var i = src.length - 1; i >= 0; i--) {
      var msb = src[i] >> 7;
      shifted[i] = ((src[i] << 1) & 0xff) | carry;
      carry = msb;
    }
    return { shifted: shifted, carry: carry };
  }

  function generateSubkey(input) {
    var result = shiftLeft(input);
    var subkey = new Uint8Array(result.shifted);
    if (result.carry) subkey[subkey.length - 1] ^= 0x87;
    return subkey;
  }

  function computeAesCmac(message, key) {
    var zeroBlock = new Uint8Array(16);
    var L = aesEcbEncrypt(key, zeroBlock);
    var K1 = generateSubkey(L);
    var M_last;
    if (message.length === 16) {
      M_last = xorArrays(message, K1);
    } else {
      var padded = new Uint8Array(16);
      padded.set(message);
      padded[message.length] = 0x80;
      var K2 = generateSubkey(K1);
      M_last = xorArrays(padded, K2);
    }
    return aesEcbEncrypt(key, M_last);
  }

  function computeCm(ks) {
    var zeroBlock = new Uint8Array(16);
    var Lprime = aesEcbEncrypt(ks, zeroBlock);
    var K1prime = generateSubkey(Lprime);
    var hk1 = generateSubkey(K1prime);
    var hashVal = new Uint8Array(hk1);
    hashVal[0] ^= 0x80;
    return aesEcbEncrypt(ks, hashVal);
  }

  function buildVerificationData(uidBytes, ctr, k2Bytes) {
    var sv2 = new Uint8Array(16);
    sv2[0] = 0x3c; sv2[1] = 0xc3; sv2[2] = 0x00; sv2[3] = 0x01;
    sv2[4] = 0x00; sv2[5] = 0x80;
    sv2.set(uidBytes, 6);
    sv2[13] = ctr[2]; sv2[14] = ctr[1]; sv2[15] = ctr[0];
    var ks = computeAesCmac(sv2, k2Bytes);
    var cm = computeCm(ks);
    return new Uint8Array([cm[1], cm[3], cm[5], cm[7], cm[9], cm[11], cm[13], cm[15]]);
  }

  function virtualTap(uidHex, counter, k1Hex, k2Hex) {
    var k1 = hexToBytes(k1Hex);
    var uid = hexToBytes(uidHex);
    var plaintext = new Uint8Array(16);
    plaintext[0] = 0xc7;
    plaintext.set(uid, 1);
    plaintext[8] = counter & 0xff;
    plaintext[9] = (counter >> 8) & 0xff;
    plaintext[10] = (counter >> 16) & 0xff;
    var encrypted = aesEcbEncrypt(k1, plaintext);
    var pHex = bytesToHex(encrypted);
    var ctrBytes = new Uint8Array([
      (counter >> 16) & 0xff,
      (counter >> 8) & 0xff,
      counter & 0xff
    ]);
    var ct = buildVerificationData(uid, ctrBytes, hexToBytes(k2Hex));
    var cHex = bytesToHex(ct);
    return { p: pHex, c: cHex };
  }

  // ─── localStorage persistence ───

  function loadVC() {
    try {
      var raw = localStorage.getItem(VC_KEY);
      if (!raw) return null;
      var data = JSON.parse(raw);
      if (data && data.uid && data.k1 && data.k2 && typeof data.counter === 'number') return data;
    } catch (e) {}
    return null;
  }

  function saveVC(card) {
    try { localStorage.setItem(VC_KEY, JSON.stringify(card)); } catch (e) {}
  }

  function clearVC() {
    try { localStorage.removeItem(VC_KEY); } catch (e) {}
  }

  // ─── State ───

  var virtualCard = loadVC();

  // ─── DOM helpers ───

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function $(id) { return document.getElementById(id); }

  function showView(viewId) {
    ['vc-no-card', 'vc-card-details'].forEach(function(id) {
      var e = $(id);
      if (e) e.classList.add('hidden');
    });
    var target = $(viewId);
    if (target) target.classList.remove('hidden');
  }

  function setStatus(msg, ok) {
    var box = $('vc-status');
    if (!box) return;
    box.textContent = msg;
    if (ok === true) {
      box.className = 'block rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm font-semibold text-emerald-200';
    } else if (ok === false) {
      box.className = 'block rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-200';
    } else {
      box.className = 'block rounded-xl border border-gray-700 bg-gray-900/80 px-4 py-3 text-sm text-gray-400';
    }
    box.classList.remove('hidden');
  }

  function updateCardDisplay() {
    if (!virtualCard) return;
    $('vc-uid').textContent = virtualCard.uid.toUpperCase();
    $('vc-counter').textContent = String(virtualCard.counter);
    $('vc-k1-full').textContent = virtualCard.k1;
    $('vc-k2-full').textContent = virtualCard.k2;
    var created = virtualCard.createdAt
      ? new Date(virtualCard.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
      : '--';
    $('vc-created').textContent = created;
  }

  // ─── Tap log ───

  function clearLog() {
    var logEl = $('vc-tap-log');
    if (!logEl) return;
    logEl.replaceChildren();
    logEl.appendChild(el('div', 'text-gray-600 text-xs italic text-center py-4', 'No taps yet.'));
  }

  function logStep(label, pass, detail) {
    var logEl = $('vc-tap-log');
    if (!logEl) return;

    var placeholder = logEl.querySelector('.italic');
    if (placeholder) logEl.replaceChildren();

    var row = el('div', 'flex items-start gap-2 py-1.5 border-b border-gray-700/30 last:border-0');
    row.appendChild(el('span', pass ? 'text-emerald-400 font-bold shrink-0' : (pass === false ? 'text-red-400 font-bold shrink-0' : 'text-indigo-400 font-bold shrink-0'),
      pass === true ? '\\u2713' : (pass === false ? '\\u2717' : '\\u2192')));
    row.appendChild(el('span', 'text-gray-300 flex-1', label));
    if (detail) {
      row.appendChild(el('span', 'text-gray-500 text-xs ml-1 font-mono break-all', detail));
    }
    logEl.appendChild(row);
    logEl.scrollTop = logEl.scrollHeight;
  }

  function logTapHeader(counter) {
    var logEl = $('vc-tap-log');
    if (!logEl) return;
    var placeholder = logEl.querySelector('.italic');
    if (placeholder) logEl.replaceChildren();

    var header = el('div', 'flex items-center gap-2 pt-2 pb-1 mt-1 border-t border-gray-700/50');
    header.appendChild(el('span', 'text-cyan-400 font-bold text-xs', '#' + counter));
    header.appendChild(el('span', 'text-gray-500 text-xs', new Date().toLocaleTimeString()));
    logEl.appendChild(header);
  }

  // ─── Create card ───

  function createCard() {
    var btn = $('vc-create-btn');
    var status = $('vc-create-status');
    btn.disabled = true;
    btn.textContent = 'Creating\\u2026';
    status.className = 'mt-3 text-sm text-gray-400';
    status.textContent = 'Generating random UID and fetching keys\\u2026';
    status.classList.remove('hidden');

    var uidBytes = new Uint8Array(7);
    crypto.getRandomValues(uidBytes);
    var uidHex = bytesToHex(uidBytes);

    fetch('/api/vc/keys?uid=' + uidHex)
      .then(function(r) {
        if (!r.ok) throw new Error('Server returned ' + r.status);
        return r.json();
      })
      .then(function(data) {
        virtualCard = {
          uid: data.uid,
          k1: data.k1,
          k2: data.k2,
          version: data.version || 1,
          counter: 1,
          createdAt: Date.now()
        };
        saveVC(virtualCard);
        updateCardDisplay();
        showView('vc-card-details');
        setStatus('Virtual card created! UID: ' + virtualCard.uid.toUpperCase(), true);
        status.classList.add('hidden');
        btn.textContent = 'Create Virtual Card';
        btn.disabled = false;
        clearLog();
      })
      .catch(function(err) {
        if (typeof window.reportClientError === 'function') window.reportClientError(err, 'virtual-card-widget.js:create');
        status.className = 'mt-3 text-sm text-red-400';
        status.textContent = 'Failed: ' + err.message;
        btn.textContent = 'Create Virtual Card';
        btn.disabled = false;
      });
  }

  // ─── Generate tap params ───

  function generateTap() {
    if (!virtualCard) return null;
    var result = virtualTap(virtualCard.uid, virtualCard.counter, virtualCard.k1, virtualCard.k2);
    var counter = virtualCard.counter;
    virtualCard.counter++;
    saveVC(virtualCard);
    updateCardDisplay();

    var lastParams = $('vc-last-params');
    if (lastParams) {
      lastParams.textContent = 'p=' + result.p.substring(0, 12) + '\\u2026 c=' + result.c.substring(0, 8) + '\\u2026';
    }

    return { p: result.p, c: result.c, counter: counter };
  }

  function getAmount() {
    var input = $('vc-amount');
    if (!input || !input.value) return null;
    var val = parseInt(input.value, 10);
    if (isNaN(val) || val <= 0) return null;
    return val;
  }

  function doFetch(url, opts) {
    return fetch(url, opts).then(function(r) {
      return r.text().then(function(text) {
        try {
          return { ok: r.ok, status: r.status, data: JSON.parse(text) };
        } catch (e) {
          return { ok: false, status: r.status, data: { error: 'Non-JSON response (status ' + r.status + ')' } };
        }
      });
    });
  }

  // ─── Tap destinations ───

  function simulateTap() {
    if (!virtualCard) { setStatus('Create a virtual card first', false); return; }

    var dest = $('vc-destination') ? $('vc-destination').value : 'lnurlw';
    var tap = generateTap();
    if (!tap) return;

    logTapHeader(tap.counter);
    logStep('Destination: ' + dest, null);

    var BASE = window.location.origin;

    if (dest === 'lnurlw') {
      logStep('Querying LNURLW\\u2026', null);
      doFetch(BASE + '/?p=' + encodeURIComponent(tap.p) + '&c=' + encodeURIComponent(tap.c))
        .then(function(r) {
          if (r.ok && r.data.tag === 'withdrawRequest') {
            logStep('withdrawRequest received', true, 'max=' + (r.data.maxWithdrawable / 1000) + ' sats');
            postTapResult({ success: true, destination: dest, response: r.data });
          } else if (r.data.status === 'ERROR') {
            logStep('Error: ' + (r.data.reason || 'unknown'), false);
            postTapResult({ success: false, destination: dest, error: r.data.reason });
          } else {
            logStep('Unexpected: ' + (r.data.tag || r.data.status || 'unknown'), false);
            postTapResult({ success: false, destination: dest, error: 'unexpected response' });
          }
        })
        .catch(function(err) {
          logStep('Fetch error: ' + err.message, false);
          postTapResult({ success: false, destination: dest, error: err.message });
        });

    } else if (dest === 'topup') {
      var amt = getAmount();
      if (!amt) { setStatus('Enter a valid amount in msat', false); return; }
      logStep('Top-up ' + amt + ' msat\\u2026', null);
      doFetch(BASE + '/operator/topup/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ p: tap.p, c: tap.c, amount: amt })
      }).then(function(r) {
        if (r.ok && (r.data.success || r.data.status === 'OK')) {
          logStep('Top-up successful', true, 'balance: ' + (r.data.balance != null ? r.data.balance : '?'));
          postTapResult({ success: true, destination: dest, response: r.data });
        } else {
          logStep('Top-up failed: ' + (r.data.reason || r.data.error || 'unknown'), false);
          postTapResult({ success: false, destination: dest, error: r.data.reason });
        }
      }).catch(function(err) {
        logStep('Fetch error: ' + err.message, false);
      });

    } else if (dest === 'pos') {
      var amt = getAmount();
      if (!amt) { setStatus('Enter a valid amount in msat', false); return; }
      logStep('POS charge ' + amt + ' msat\\u2026', null);
      doFetch(BASE + '/operator/pos/charge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ p: tap.p, c: tap.c, amount: amt })
      }).then(function(r) {
        if (r.ok && (r.data.status === 'OK' || r.data.success)) {
          logStep('Charge successful', true, r.data.reason || '');
          postTapResult({ success: true, destination: dest, response: r.data });
        } else {
          logStep('Charge failed: ' + (r.data.reason || r.data.error || 'unknown'), false);
          postTapResult({ success: false, destination: dest, error: r.data.reason });
        }
      }).catch(function(err) {
        logStep('Fetch error: ' + err.message, false);
      });

    } else if (dest === 'refund') {
      var amt = getAmount();
      if (!amt) { setStatus('Enter a valid amount in msat', false); return; }
      logStep('Refund ' + amt + ' msat\\u2026', null);
      doFetch(BASE + '/operator/refund/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ p: tap.p, c: tap.c, amount: amt })
      }).then(function(r) {
        if (r.ok && (r.data.success || r.data.status === 'OK')) {
          logStep('Refund successful', true, r.data.reason || '');
          postTapResult({ success: true, destination: dest, response: r.data });
        } else {
          logStep('Refund failed: ' + (r.data.reason || r.data.error || 'unknown'), false);
          postTapResult({ success: false, destination: dest, error: r.data.reason });
        }
      }).catch(function(err) {
        logStep('Fetch error: ' + err.message, false);
      });

    } else if (dest === 'balance') {
      logStep('Checking balance\\u2026', null);
      doFetch(BASE + '/api/balance-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ p: tap.p, c: tap.c })
      }).then(function(r) {
        if (r.ok && r.data.balance !== undefined) {
          logStep('Balance: ' + r.data.balance + ' msat', true);
          postTapResult({ success: true, destination: dest, response: r.data });
        } else {
          logStep('Balance check failed: ' + (r.data.reason || 'unknown'), false);
          postTapResult({ success: false, destination: dest, error: r.data.reason });
        }
      }).catch(function(err) {
        logStep('Fetch error: ' + err.message, false);
      });

    } else if (dest === 'cardinfo') {
      logStep('Fetching card info\\u2026', null);
      doFetch(BASE + '/card/info?p=' + encodeURIComponent(tap.p) + '&c=' + encodeURIComponent(tap.c))
        .then(function(r) {
          if (r.ok && r.data.state) {
            logStep('State: ' + r.data.state, true,
              'balance: ' + (r.data.balance != null ? r.data.balance : '?') + ' msat');
            var stateBadge = $('vc-state-text');
            if (stateBadge) stateBadge.textContent = r.data.state;
            postTapResult({ success: true, destination: dest, response: r.data });
          } else {
            logStep('Card info failed: ' + (r.data.reason || r.data.error || 'unknown'), false);
            postTapResult({ success: false, destination: dest, error: r.data.reason });
          }
        })
        .catch(function(err) {
          logStep('Fetch error: ' + err.message, false);
        });
    }
  }

  function postTapResult(result) {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage(Object.assign({ source: 'virtual-card-widget', type: 'tap' }, result), '*');
    }
  }

  // ─── Auto-test lifecycle ───

  function autoTest() {
    if (!virtualCard) { setStatus('Create a virtual card first', false); return; }

    var autoBtn = $('vc-auto-btn');
    var tapBtn = $('vc-tap-btn');
    autoBtn.disabled = true;
    tapBtn.disabled = true;
    autoBtn.textContent = 'Running\\u2026';

    clearLog();
    var BASE = window.location.origin;
    var allPassed = true;

    function step(label, pass, detail) {
      logStep(label, pass, detail);
      if (pass === false) allPassed = false;
    }

    (async function() {
      try {
        step('Step 1: Initial tap (discover card)', null);
        var t1 = generateTap();
        var r1 = await doFetch(BASE + '/?p=' + encodeURIComponent(t1.p) + '&c=' + encodeURIComponent(t1.c));
        if (r1.ok && r1.data.tag === 'withdrawRequest') {
          step('  withdrawRequest received', true, 'max=' + (r1.data.maxWithdrawable / 1000) + ' sats');
        } else if (r1.data.status === 'ERROR') {
          step('  Error: ' + (r1.data.reason || 'unknown'), false);
        } else {
          step('  Unexpected response', false);
        }

        step('Step 2: Top-up 10000 msat', null);
        var t2 = generateTap();
        var r2 = await doFetch(BASE + '/operator/topup/apply', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ p: t2.p, c: t2.c, amount: 10000 })
        });
        if (r2.ok && (r2.data.success || r2.data.status === 'OK')) {
          step('  Top-up successful', true, 'balance: ' + (r2.data.balance != null ? r2.data.balance : '?'));
        } else {
          step('  Top-up failed: ' + (r2.data.reason || r2.data.error || 'unknown'), false);
        }

        step('Step 3: POS charge 3000 msat', null);
        var t3 = generateTap();
        var r3 = await doFetch(BASE + '/operator/pos/charge', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ p: t3.p, c: t3.c, amount: 3000 })
        });
        if (r3.ok && (r3.data.status === 'OK' || r3.data.success)) {
          step('  Charge successful', true);
        } else {
          step('  Charge failed: ' + (r3.data.reason || r3.data.error || 'unknown'), false);
        }

        step('Step 4: Refund 3000 msat', null);
        var t4 = generateTap();
        var r4 = await doFetch(BASE + '/operator/refund/apply', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ p: t4.p, c: t4.c, amount: 3000 })
        });
        if (r4.ok && (r4.data.success || r4.data.status === 'OK')) {
          step('  Refund successful', true);
        } else {
          step('  Refund failed: ' + (r4.data.reason || r4.data.error || 'unknown'), false);
        }

        step('Step 5: Verify balance = 10000 msat', null);
        var t5 = generateTap();
        var r5 = await doFetch(BASE + '/api/balance-check', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ p: t5.p, c: t5.c })
        });
        if (r5.ok && r5.data.balance !== undefined) {
          var balOk = r5.data.balance === 10000;
          step('  Balance: ' + r5.data.balance + ' msat', balOk, balOk ? 'correct' : 'expected 10000');
        } else {
          step('  Balance check failed', false);
        }

        var logEl = $('vc-tap-log');
        var summary = el('div',
          'flex items-center gap-2 pt-3 mt-2 border-t border-gray-700/50 text-sm font-bold ' +
          (allPassed ? 'text-emerald-400' : 'text-amber-400'),
          allPassed ? '\\u2713 All steps passed!' : '\\u26a0 Some steps failed');
        logEl.appendChild(summary);

        setStatus(allPassed ? 'Auto-test completed: all passed' : 'Auto-test completed: some failures', allPassed);
      } catch (err) {
        if (typeof window.reportClientError === 'function') window.reportClientError(err, 'virtual-card-widget.js:auto-test');
        step('Unexpected error: ' + err.message, false);
        setStatus('Auto-test failed: ' + err.message, false);
      }

      autoBtn.textContent = 'Auto-Test';
      autoBtn.disabled = false;
      tapBtn.disabled = false;
    })();
  }

  // ─── Destination change handler ───

  function onDestinationChange() {
    var dest = $('vc-destination');
    if (!dest) return;
    var amountRow = $('vc-amount-row');
    var amountInput = $('vc-amount');
    var needsAmount = ['topup', 'pos', 'refund'].indexOf(dest.value) !== -1;
    if (amountRow) {
      amountRow.classList.toggle('hidden', !needsAmount);
    }
    if (amountInput && !needsAmount) {
      amountInput.value = '';
    }
  }

  // ─── Copy to clipboard ───

  function copyText(targetId) {
    var e = $(targetId);
    if (!e) return;
    var text = e.textContent || '';
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(function() {
        flashCopyButton(targetId);
      }).catch(function() {});
    } else {
      var range = document.createRange();
      range.selectNodeContents(e);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      try { document.execCommand('copy'); flashCopyButton(targetId); } catch (e2) {}
      sel.removeAllRanges();
    }
  }

  function flashCopyButton(targetId) {
    document.querySelectorAll('.vc-copy-btn').forEach(function(btn) {
      if (btn.getAttribute('data-target') === targetId) {
        var original = btn.textContent;
        btn.textContent = 'Copied!';
        btn.classList.add('text-emerald-400');
        setTimeout(function() {
          btn.textContent = original;
          btn.classList.remove('text-emerald-400');
        }, 1200);
      }
    });
  }

  // ─── Keys toggle ───

  function toggleKeys() {
    var content = $('vc-keys-content');
    var chevron = $('vc-keys-chevron');
    if (!content) return;
    var isHidden = content.classList.contains('hidden');
    content.classList.toggle('hidden', !isHidden);
    if (chevron) {
      chevron.style.transform = isHidden ? 'rotate(180deg)' : 'rotate(0deg)';
    }
  }

  // ─── Init ───

  function init() {
    if (virtualCard) {
      updateCardDisplay();
      showView('vc-card-details');
    } else {
      showView('vc-no-card');
    }

    var createBtn = $('vc-create-btn');
    if (createBtn) createBtn.addEventListener('click', createCard);

    var tapBtn = $('vc-tap-btn');
    if (tapBtn) tapBtn.addEventListener('click', simulateTap);

    var autoBtn = $('vc-auto-btn');
    if (autoBtn) autoBtn.addEventListener('click', autoTest);

    var dest = $('vc-destination');
    if (dest) dest.addEventListener('change', onDestinationChange);

    var keysToggle = $('vc-keys-toggle');
    if (keysToggle) keysToggle.addEventListener('click', toggleKeys);

    var clearLogBtn = $('vc-clear-log');
    if (clearLogBtn) clearLogBtn.addEventListener('click', clearLog);

    document.querySelectorAll('.vc-copy-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        copyText(btn.getAttribute('data-target'));
      });
    });

    var deleteBtn = $('vc-delete-btn');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', function() {
        $('vc-delete-confirm').classList.remove('hidden');
      });
    }

    var resetBtn = $('vc-reset-btn');
    if (resetBtn) {
      resetBtn.addEventListener('click', function() {
        clearVC();
        virtualCard = null;
        clearLog();
        showView('vc-no-card');
        $('vc-delete-confirm').classList.add('hidden');
      });
    }

    var deleteCancel = $('vc-delete-cancel');
    if (deleteCancel) {
      deleteCancel.addEventListener('click', function() {
        $('vc-delete-confirm').classList.add('hidden');
      });
    }

    var deleteConfirm = $('vc-delete-confirm-btn');
    if (deleteConfirm) {
      deleteConfirm.addEventListener('click', function() {
        clearVC();
        location.reload();
      });
    }
  }

  // Expose for E2E testing
  window._vcTap = function() {
    if (!virtualCard) return null;
    return generateTap();
  };
  window._vcGetKeys = function() {
    return virtualCard
      ? { uid: virtualCard.uid, k1: virtualCard.k1, k2: virtualCard.k2, counter: virtualCard.counter }
      : null;
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();`;
export const VIRTUAL_CARD_WIDGET_JS_HASH = "2acbe3474a57";

export const CLIENT_ERROR_JS = `// client-error.js — reports uncaught JS errors to the server with page version info
(function() {
  function getVersion() {
    var meta = document.querySelector('meta[name="deploy-revision"]');
    return meta ? meta.getAttribute('content') : 'unknown';
  }

  function getJsFingerprint() {
    var meta = document.querySelector('meta[name="js-fingerprint"]');
    return meta ? meta.getAttribute('content') : 'unknown';
  }

  function getPageUrl() {
    try { return location.pathname + location.search; } catch(e) { return ''; }
  }

  function report(error, context) {
    if (!error) return;
    var payload = {
      message: (error && error.message) ? error.message : String(error),
      stack: (error && error.stack) ? String(error.stack).substring(0, 2000) : '',
      source: context || '',
      url: getPageUrl(),
      deploy: getVersion(),
      js: getJsFingerprint(),
      ts: Date.now()
    };
    try {
      navigator.sendBeacon('/api/client-error', JSON.stringify(payload));
    } catch(e) {
      fetch('/api/client-error', { method: 'POST', body: JSON.stringify(payload), headers: { 'Content-Type': 'application/json' }, keepalive: true }).catch(function() {});
    }
  }

  window.reportClientError = report;

  window.onerror = function(message, source, lineno, colno, error) {
    report(error || message, 'onerror:' + (source || '') + ':' + lineno + ':' + colno);
  };

  window.addEventListener('unhandledrejection', function(event) {
    var reason = event.reason;
    report(reason instanceof Error ? reason : new Error(String(reason)), 'unhandledrejection');
  });
})();`;
export const CLIENT_ERROR_JS_HASH = "65664854a4c3";

export const HELPERS_JS = `// helpers.js — classic script (no import/export)

function setText(id, text) {
  var el = document.getElementById(id);
  if (el) el.textContent = text != null ? String(text) : '';
}

function showEl(id) {
  var el = document.getElementById(id);
  if (el) el.classList.remove('hidden');
}

function hideEl(id) {
  var el = document.getElementById(id);
  if (el) el.classList.add('hidden');
}

function toggleEl(id) {
  var el = document.getElementById(id);
  if (el) el.classList.toggle('hidden');
}

function formatDuration(ms) {
  var totalSec = Math.floor(ms / 1000);
  var h = String(Math.floor(totalSec / 3600)).padStart(2, '0');
  var m = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
  var s = String(totalSec % 60).padStart(2, '0');
  return h + ':' + m + ':' + s;
}

function relativeTime(unixSeconds) {
  var diff = Math.floor(Date.now() / 1000) - unixSeconds;
  if (diff < 60) return 'just now';
  if (diff < 3600) return Math.floor(diff / 60) + ' min ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  if (diff < 604800) return Math.floor(diff / 86400) + 'd ago';
  return new Date(unixSeconds * 1000).toLocaleDateString();
}

function formatUnits(value) {
  if (!value || value === 0) return '';
  return Number(value).toLocaleString();
}

function statusBadge(status) {
  var map = {
    read:        'bg-sky-500/10 text-sky-400 border-sky-500/30',
    provisioned: 'bg-purple-500/10 text-purple-400 border-purple-500/30',
    activated:   'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
    wipe_requested: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
    terminated:  'bg-red-500/10 text-red-400 border-red-500/30',
    completed:   'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
    failed:      'bg-red-500/10 text-red-400 border-red-500/30',
    pending:     'bg-yellow-500/10 text-yellow-400 border-yellow-500/30',
    paying:      'bg-blue-500/10 text-blue-400 border-blue-500/30',
    expired:     'bg-gray-600/10 text-gray-400 border-gray-500/30',
    topup:       'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
    payment:     'bg-orange-500/10 text-orange-400 border-orange-500/30',
  };
  var labels = { topup: 'TOP UP', payment: 'PAYMENT' };
  var cls = map[status] || map.pending;
  var label = labels[status] || status;
  var span = document.createElement('span');
  span.className = 'px-1.5 py-0.5 rounded text-[10px] font-bold border ' + cls;
  span.textContent = label;
  return span;
}`;
export const HELPERS_JS_HASH = "84e8b5eb92ca";

export const CARD_INFO_JS = `// card-info.js — classic script (no import/export)
// Depends on: helpers.js (relativeTime, formatUnits, statusBadge)

/**
 * Render tap history into prefixed DOM elements.
 * @param {Array} taps - Array of tap objects with created_at, status, amount_msat, counter, note, balance_after
 * @param {string} prefix - Element ID prefix (e.g., 'priv', 'pub')
 */
function renderTapHistory(taps, prefix) {
  var section = document.getElementById(prefix + '-tap-history');
  var list = document.getElementById(prefix + '-tap-list');
  var countEl = document.getElementById(prefix + '-tap-count');
  if (!taps || taps.length === 0) {
    section.classList.remove('hidden');
    list.replaceChildren();
    countEl.textContent = '';
    document.getElementById(prefix + '-tap-empty').classList.remove('hidden');
    return;
  }
  document.getElementById(prefix + '-tap-empty').classList.add('hidden');
  countEl.textContent = taps.length + ' entries';
  var elements = [];
  for (var i = 0; i < taps.length; i++) {
    var t = taps[i];
    var time = relativeTime(t.created_at);
    var isTopup = t.status === 'topup';
    var isPayment = t.status === 'payment';

    var amountEl = null;
    if (isTopup && t.amount_msat) {
      amountEl = document.createElement('span');
      amountEl.className = 'font-mono text-emerald-400 font-bold';
      amountEl.textContent = '+' + formatUnits(t.amount_msat);
    } else if (isPayment && t.amount_msat) {
      amountEl = document.createElement('span');
      amountEl.className = 'font-mono text-orange-400 font-bold';
      amountEl.textContent = '-' + formatUnits(t.amount_msat);
    } else if (t.amount_msat) {
      amountEl = document.createElement('span');
      amountEl.className = 'font-mono text-gray-400';
      amountEl.textContent = formatUnits(t.amount_msat);
    }

    var detailParts = [];
    if (t.counter != null) detailParts.push('#' + String(t.counter));
    if (t.note) detailParts.push(t.note);
    if (t.balance_after != null && (isTopup || isPayment)) detailParts.push('bal: ' + String(t.balance_after));

    var outer = document.createElement('div');
    outer.className = 'py-2 border-b border-gray-700/50 last:border-0';
    var row = document.createElement('div');
    row.className = 'flex items-center justify-between';
    var left = document.createElement('div');
    left.className = 'flex items-center gap-2';
    var timeSpan = document.createElement('span');
    timeSpan.className = 'text-gray-500 text-xs shrink-0';
    timeSpan.textContent = time;
    left.appendChild(timeSpan);
    left.appendChild(statusBadge(t.status));
    row.appendChild(left);
    if (amountEl) row.appendChild(amountEl);
    outer.appendChild(row);
    if (detailParts.length > 0) {
      var detailDiv = document.createElement('div');
      detailDiv.className = 'text-gray-500 text-[11px] mt-0.5 pl-1';
      detailDiv.textContent = detailParts.join(' \\u00B7 ');
      outer.appendChild(detailDiv);
    }
    elements.push(outer);
  }
  list.replaceChildren.apply(list, elements);
  section.classList.remove('hidden');
}

/**
 * Build K0-K4 key rows as a DocumentFragment for appending to a tbody.
 * @param {string} k0-k4 - Hex key values
 * @returns {DocumentFragment}
 */
function buildKeysRows(k0, k1, k2, k3, k4) {
  var keys = [
    { label: 'K0', value: k0 },
    { label: 'K1', value: k1 },
    { label: 'K2', value: k2 },
    { label: 'K3', value: k3 },
    { label: 'K4', value: k4 }
  ];
  var fragment = document.createDocumentFragment();
  for (var i = 0; i < keys.length; i++) {
    var tr = document.createElement('tr');
    var td1 = document.createElement('td');
    td1.className = 'pr-3 text-gray-500';
    td1.textContent = keys[i].label;
    var td2 = document.createElement('td');
    td2.className = 'font-mono text-xs text-gray-400';
    td2.textContent = keys[i].value || '-';
    tr.appendChild(td1);
    tr.appendChild(td2);
    fragment.appendChild(tr);
  }
  return fragment;
}`;
export const CARD_INFO_JS_HASH = "41e1cbc054f8";

export const CARD_ACTIONS_JS = `// card-actions.js — classic script (no import/export)
// Depends on: helpers.js (reportClientError via window)

/**
 * Request wipe keys for a card via /login endpoint.
 * @param {string} apiHost - API base URL
 * @param {string} uid - Card UID hex
 * @param {Object} opts - { btnId, statusId, qrId, deeplinkId, jsonId, resultId }
 * @returns {Promise}
 */
function requestWipeKeys(apiHost, uid, opts) {
  if (!uid) return Promise.resolve();
  var btn = document.getElementById(opts.btnId);
  var status = document.getElementById(opts.statusId);
  btn.disabled = true;
  btn.textContent = 'FETCHING...';
  btn.classList.add('opacity-50');
  status.classList.remove('hidden');
  status.className = 'mt-3 text-center text-sm text-gray-400';
  status.textContent = 'Retrieving wipe keys...';

  return fetch(apiHost + '/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uid: uid, action: 'request-wipe' }),
  }).then(function(resp) { return resp.json().then(function(data) { return { ok: resp.ok, data: data }; }); })
  .then(function(result) {
    if (result.ok && result.data.success) {
      btn.textContent = 'WIPE KEYS RETRIEVED';
      btn.classList.remove('bg-red-600', 'hover:bg-red-500');
      btn.classList.add('bg-gray-600');
      status.className = 'mt-3 text-center text-sm text-emerald-400';
      status.textContent = 'Card is now pending wipe (v' + result.data.keyVersion + ')';
      if (opts.qrId && typeof QRCode !== 'undefined') {
        var qrEl = document.getElementById(opts.qrId);
        qrEl.replaceChildren();
        new QRCode(qrEl, { text: result.data.wipeJson, width: 200, height: 200, colorDark: "#000000", colorLight: "#ffffff", correctLevel: QRCode.CorrectLevel.L });
      }
      if (opts.deeplinkId) document.getElementById(opts.deeplinkId).href = result.data.wipeDeeplink;
      if (opts.jsonId) document.getElementById(opts.jsonId).textContent = result.data.wipeJson;
      if (opts.resultId) document.getElementById(opts.resultId).classList.remove('hidden');
      return result.data;
    } else {
      throw new Error(result.data.error || 'Failed to fetch wipe keys');
    }
  }).catch(function(e) {
    if (typeof window.reportClientError === 'function') window.reportClientError(e, 'card-actions:request-wipe');
    status.className = 'mt-3 text-center text-sm text-red-400';
    status.textContent = 'Error: ' + e.message;
    btn.disabled = false;
    btn.textContent = 'GET WIPE KEYS';
    btn.classList.remove('opacity-50');
    throw e;
  });
}

/**
 * Confirm a card has been physically wiped (terminate via /login).
 * @param {string} apiHost - API base URL
 * @param {string} uid - Card UID hex
 * @param {Object} opts - { btnId, statusId }
 * @returns {Promise<Object>} Termination result data
 */
function confirmWipedCard(apiHost, uid, opts) {
  if (!uid) return Promise.reject(new Error('No UID'));
  var btn = document.getElementById(opts.btnId);
  var status = document.getElementById(opts.statusId);
  btn.disabled = true;
  btn.textContent = 'TERMINATING...';
  btn.classList.add('opacity-50');
  status.classList.remove('hidden');
  status.className = 'mt-3 text-center text-sm text-gray-400';
  status.textContent = 'Terminating card...';

  return fetch(apiHost + '/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uid: uid, action: 'terminate' }),
  }).then(function(resp) { return resp.json().then(function(data) { return { ok: resp.ok, data: data }; }); })
  .then(function(result) {
    if (result.ok && result.data.success) {
      status.className = 'mt-3 text-center text-sm text-emerald-400';
      status.textContent = 'Card terminated. Ready for re-provision at version ' + (result.data.keyVersion || 2) + '.';
      btn.textContent = 'TERMINATED';
      btn.classList.remove('bg-red-600', 'hover:bg-red-500');
      btn.classList.add('bg-gray-600');
      return result.data;
    } else {
      throw new Error(result.data.error || 'Termination failed');
    }
  }).catch(function(e) {
    if (typeof window.reportClientError === 'function') window.reportClientError(e, 'card-actions:confirm-wiped');
    status.className = 'mt-3 text-center text-sm text-red-400';
    status.textContent = 'Error: ' + e.message;
    btn.disabled = false;
    btn.textContent = 'YES, THIS CARD HAS BEEN WIPED';
    btn.classList.remove('opacity-50');
    throw e;
  });
}

/**
 * Provision a card by posting to a programming endpoint.
 * @param {string} endpointUrl - The pull payment / boltcards endpoint URL
 * @param {string} uid - Card UID hex
 * @param {Object} opts - { btnId, statusId, successText }
 * @returns {Promise<Object>} Provisioning result
 */
function provisionCard(endpointUrl, uid, opts) {
  if (!uid) return Promise.reject(new Error('No UID'));
  var btn = document.getElementById(opts.btnId);
  var status = document.getElementById(opts.statusId);
  btn.disabled = true;
  btn.textContent = 'PROVISIONING...';
  btn.classList.add('opacity-50');
  status.classList.remove('hidden');
  status.className = 'mt-3 text-center text-sm text-gray-400';
  status.textContent = 'Writing keys to card...';

  return fetch(endpointUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ UID: uid }),
  }).then(function(resp) { return resp.json().then(function(data) { return { ok: resp.ok, data: data }; }); })
  .then(function(result) {
    if (result.ok) {
      status.className = 'mt-3 text-center text-sm text-emerald-400';
      status.textContent = (opts.successText || 'Card provisioned!') + ' Version ' + (result.data.Version || 1) + '.';
      btn.textContent = 'PROVISIONED';
      btn.classList.remove('bg-emerald-600', 'hover:bg-emerald-500');
      btn.classList.add('bg-gray-600');
      return result.data;
    } else {
      throw new Error(result.data.error || 'Provisioning failed');
    }
  }).catch(function(e) {
    if (typeof window.reportClientError === 'function') window.reportClientError(e, 'card-actions:provision');
    status.className = 'mt-3 text-center text-sm text-red-400';
    if (e.message.includes('active') || e.message.includes('Terminate')) {
      status.textContent = 'This card is already active and working. Wipe it first if you want to re-provision.';
    } else {
      status.textContent = 'Error: ' + e.message;
    }
    btn.disabled = false;
    btn.textContent = opts.btnText || 'PROVISION AS WITHDRAW CARD';
    btn.classList.remove('opacity-50');
    throw e;
  });
}`;
export const CARD_ACTIONS_JS_HASH = "9a43a89754b4";

export const PROGRAMMING_JS = `// programming.js — classic script (no import/export)
// Depends on: helpers.js (relativeTime)

/**
 * Build a boltcard programming deeplink URL.
 * @param {string} endpointUrl - The programming endpoint URL
 * @returns {string} boltcard://program?url=... deeplink
 */
function buildProgrammingDeeplink(endpointUrl) {
  return 'boltcard://program?url=' + encodeURIComponent(endpointUrl);
}

/**
 * Render a QR code into a container element, replacing any existing content.
 * @param {string} containerId - Element ID to render QR into
 * @param {string} text - QR code content
 */
function renderQrCode(containerId, text) {
  if (typeof QRCode === 'undefined') return;
  var el = document.getElementById(containerId);
  if (!el) return;
  el.replaceChildren();
  new QRCode(el, { text: text, width: 200, height: 200, colorDark: "#000000", colorLight: "#ffffff", correctLevel: QRCode.CorrectLevel.L });
}

/**
 * Build wipe JSON from key cells in a table.
 * @param {string} tableId - tbody element ID containing key rows
 * @returns {string} JSON string of wipe data
 */
function buildWipeJson(tableId) {
  var cells = document.querySelectorAll('#' + tableId + ' td:last-child');
  var vals = Array.from(cells).map(function(t) { return t.textContent.trim(); });
  return JSON.stringify({
    k0: vals[0] || '', k1: vals[1] || '', k2: vals[2] || '',
    k3: vals[3] || '', k4: vals[4] || '',
    action: 'wipe', version: '1'
  }, null, 2);
}`;
export const PROGRAMMING_JS_HASH = "9c1970f908eb";

export const CSRF_JS = `// csrf.js — classic script (no import/export)

function getCsrfToken() {
  var match = document.cookie.match(/(?:^|;\\s*)op_csrf=([^;]*)/);
  return match ? match[1] : '';
}
var _origFetch = window.fetch;
window.fetch = function(input, init) {
  init = init || {};
  init.headers = init.headers || {};
  if (typeof init.headers.set === 'function') {
    if (!init.headers.has('X-CSRF-Token')) init.headers.set('X-CSRF-Token', getCsrfToken());
  } else {
    if (!init.headers['X-CSRF-Token']) init.headers['X-CSRF-Token'] = getCsrfToken();
  }
  return _origFetch.call(this, input, init);
};`;
export const CSRF_JS_HASH = "27a4b8928b37";

export const CARD_DASHBOARD_JS = `// card-dashboard.js — classic script (no import/export)
// Depends on: nfc.js (browserSupportsNfc, createNfcScanner, stateLabel, stateColor, provenanceLabel, provenanceColor)

var lastP = null;
var lastC = null;
var cardLoaded = false;
var lastLoadTime = null;
var deferredPrompt = null;
var staleTimer = null;

var STORAGE_KEY = 'boltcard_params';

// ─── Currency formatting ───

var currencyLabel = 'credits';
var currencyDecimals = 0;
var previousBalance = null;

function animateBalance(element, fromValue, toValue) {
  var from = (typeof fromValue === 'number') ? fromValue : parseInt(fromValue, 10);
  var to = (typeof toValue === 'number') ? toValue : parseInt(toValue, 10);
  if (!Number.isFinite(from)) from = 0;
  if (!Number.isFinite(to)) to = 0;
  if (from === to) {
    element.textContent = formatBalance(to);
    return;
  }
  var duration = 500;
  var start = null;
  function step(ts) {
    if (!start) start = ts;
    var elapsed = ts - start;
    var progress = Math.min(elapsed / duration, 1);
    var eased = 1 - Math.pow(1 - progress, 3);
    var current = Math.round(from + (to - from) * eased);
    element.textContent = formatBalance(current);
    if (progress < 1) {
      requestAnimationFrame(step);
    }
  }
  requestAnimationFrame(step);
}

function formatBalance(raw) {
  if (!raw && raw !== 0) return '0 ' + currencyLabel;
  var value = typeof raw === 'number' ? raw : parseInt(raw, 10);
  if (!Number.isFinite(value)) return '0 ' + currencyLabel;
  var divisor = Math.pow(10, currencyDecimals);
  var display = (value / divisor).toFixed(currencyDecimals);
  var parts = display.split('.');
  var whole = parts[0].replace(/\\B(?=(\\d{3})+(?!\\d))/g, ',');
  var formatted = currencyDecimals > 0 ? whole + '.' + parts[1] : whole;
  return formatted + ' ' + currencyLabel;
}

// ─── localStorage persistence ───

function saveCardParams(p, c) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ p: p, c: c, savedAt: Date.now() }));
  } catch (e) {}
}

function loadSavedParams() {
  try {
    var raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    var data = JSON.parse(raw);
    if (data && data.p && data.c) return data;
  } catch (e) {}
  return null;
}

function clearSavedParams() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {}
}

// ─── Install prompt ───

window.addEventListener('beforeinstallprompt', function(e) {
  e.preventDefault();
  deferredPrompt = e;
  if (cardLoaded) {
    document.getElementById('install-banner').classList.remove('hidden');
  }
});

document.getElementById('btn-install').addEventListener('click', function() {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then(function() {
      deferredPrompt = null;
      document.getElementById('install-banner').classList.add('hidden');
    });
  }
});

// ─── Offline detection ───

function updateOnlineStatus() {
  var offline = document.getElementById('offline-banner');
  if (!navigator.onLine) {
    offline.classList.remove('hidden');
  } else {
    offline.classList.add('hidden');
  }
}

window.addEventListener('online', updateOnlineStatus);
window.addEventListener('offline', updateOnlineStatus);
updateOnlineStatus();

// ─── Stale data tracking ───

function updateStaleIndicator() {
  if (!lastLoadTime) return;
  var elapsed = Math.floor((Date.now() - lastLoadTime) / 1000);
  if (elapsed > 30) {
    var staleEl = document.getElementById('stale-time');
    if (elapsed < 60) staleEl.textContent = elapsed + 's ago';
    else if (elapsed < 3600) staleEl.textContent = Math.floor(elapsed / 60) + 'min ago';
    else staleEl.textContent = Math.floor(elapsed / 3600) + 'h ago';
    document.getElementById('stale-banner').classList.remove('hidden');
  }
}

staleTimer = setInterval(updateStaleIndicator, 10000);

document.getElementById('btn-refresh-stale').addEventListener('click', function() {
  if (lastP && lastC) showCardInfo(lastP, lastC);
});

// ─── Pull-to-refresh ───

(function() {
  var startY = 0;
  var pulling = false;
  var container = document.getElementById('pull-container');
  if (!container) return;

  container.addEventListener('touchstart', function(e) {
    if (window.scrollY === 0 && e.touches.length === 1) {
      startY = e.touches[0].clientY;
      pulling = true;
    }
  }, { passive: true });

  container.addEventListener('touchmove', function(e) {
    if (!pulling) return;
    var diff = e.touches[0].clientY - startY;
    if (diff > 60) {
      container.style.opacity = '0.7';
      container.style.transform = 'translateY(8px)';
    }
  }, { passive: true });

  container.addEventListener('touchend', function(e) {
    if (!pulling) return;
    pulling = false;
    var diff = e.changedTouches[0].clientY - startY;
    container.style.opacity = '';
    container.style.transform = '';
    if (diff > 60 && lastP && lastC) {
      showCardInfo(lastP, lastC);
    }
  }, { passive: true });
})();

// ─── Forget / Scan different card ───

document.getElementById('btn-forget').addEventListener('click', function() {
  clearSavedParams();
  window.location.href = '/card';
});

document.getElementById('btn-scan-different').addEventListener('click', function() {
  resetView();
  cardScanner.restart();
});

// ─── Formatters ───

function formatTime(iso) {
  if (!iso) return null;
  try {
    var d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch (e) { return iso; }
}

function relativeTime(iso) {
  if (!iso) return '';
  try {
    var now = Date.now();
    var then = new Date(iso).getTime();
    if (!Number.isFinite(then)) return '';
    var diff = Math.floor((now - then) / 1000);
    if (diff < 0) return 'just now';
    if (diff < 60) return diff + 's ago';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    if (diff < 172800) return 'Yesterday';
    if (diff < 604800) return Math.floor(diff / 86400) + 'd ago';
    return formatTime(iso);
  } catch (e) { return ''; }
}

function renderHistory(items) {
  var el = document.getElementById('history-list');
  if (!items || items.length === 0) {
    var p = document.createElement('p');
    p.className = 'text-gray-500 text-xs text-center';
    p.textContent = 'No activity';
    el.replaceChildren(p);
    return;
  }
  el.replaceChildren.apply(el, items.slice(0, 15).map(function(item) {
    var status = item.status || 'unknown';
    var icon, iconColor, label, labelBg;
    if (status === 'topup' || status === 'credit') {
      icon = '+'; iconColor = 'text-emerald-400'; label = status; labelBg = 'bg-emerald-900/40 text-emerald-400';
    } else if (status === 'payment' || status === 'debit') {
      icon = '\\u2212'; iconColor = 'text-red-400'; label = status; labelBg = 'bg-red-900/40 text-red-400';
    } else if (status === 'refund' || status === 'void') {
      icon = '\\u21A9'; iconColor = 'text-cyan-400'; label = status; labelBg = 'bg-cyan-900/40 text-cyan-400';
    } else if (status === 'read' || status === 'tap') {
      icon = '\\u2022'; iconColor = 'text-gray-500'; label = status; labelBg = 'bg-gray-800 text-gray-500';
    } else if (status === 'completed') {
      icon = '\\u2713'; iconColor = 'text-emerald-400'; label = status; labelBg = 'bg-emerald-900/40 text-emerald-400';
    } else if (status === 'failed') {
      icon = '\\u2717'; iconColor = 'text-red-400'; label = status; labelBg = 'bg-red-900/40 text-red-400';
    } else {
      icon = '?'; iconColor = 'text-gray-500'; label = status; labelBg = 'bg-gray-800 text-gray-500';
    }
    var amt = item.amount_msat || item.amountMsat;
    var relTime = relativeTime(item.created_at || item.createdAt);

    var row = document.createElement('div');
    row.className = 'flex items-center gap-2 text-xs py-1.5 border-b border-gray-700/30 last:border-0';

    var iconSpan = document.createElement('span');
    iconSpan.className = iconColor + ' w-4 text-center font-bold text-sm';
    iconSpan.textContent = icon;
    row.appendChild(iconSpan);

    var pill = document.createElement('span');
    pill.className = labelBg + ' text-[10px] px-1.5 py-0.5 rounded-full font-medium';
    pill.textContent = label;
    row.appendChild(pill);

    if (item.note) {
      var noteSpan = document.createElement('span');
      noteSpan.className = 'text-gray-600 truncate max-w-[80px]';
      noteSpan.textContent = item.note;
      row.appendChild(noteSpan);
    }

    var spacer = document.createElement('span');
    spacer.className = 'flex-1';
    row.appendChild(spacer);

    if (amt) {
      var isCredit = status === 'topup' || status === 'credit' || status === 'refund' || status === 'void';
      var amtSpan = document.createElement('span');
      amtSpan.className = isCredit ? 'text-emerald-400 font-mono' : 'text-red-400 font-mono';
      var prefix = isCredit ? '+' : '\\u2212';
      amtSpan.textContent = prefix + formatBalance(amt);
      row.appendChild(amtSpan);
    }

    if (relTime) {
      var timeSpan = document.createElement('span');
      timeSpan.className = 'text-gray-600 text-[10px] w-16 text-right shrink-0';
      timeSpan.textContent = relTime;
      row.appendChild(timeSpan);
    }

    return row;
  }));
}

function showLoading() {
  document.getElementById('loading').classList.remove('hidden');
  document.getElementById('card-info').classList.add('hidden');
  document.getElementById('error-display').classList.add('hidden');
}

function hideLoading() {
  document.getElementById('loading').classList.add('hidden');
}

async function showCardInfo(p, c) {
  lastP = p;
  lastC = c;
  document.getElementById('error-display').classList.add('hidden');
  showLoading();

  try {
    var resp = await fetch('/card/info?p=' + encodeURIComponent(p) + '&c=' + encodeURIComponent(c));
    var data = await resp.json();

    hideLoading();

    if (!resp.ok) {
      showError(data.reason || data.error || 'Failed to load card info');
      return;
    }

    cardLoaded = true;
    lastLoadTime = Date.now();
    document.getElementById('stale-banner').classList.add('hidden');

    if (data.currencyLabel) currencyLabel = data.currencyLabel;
    if (data.currencyDecimals !== undefined) currencyDecimals = data.currencyDecimals;

    // Save params to localStorage for auto-load next time
    saveCardParams(p, c);

    document.getElementById('scan-section').classList.add('hidden');
    document.getElementById('card-info').classList.remove('hidden');

    document.getElementById('card-uid').textContent = data.maskedUid || data.uid;

    var stateEl = document.getElementById('card-state');
    stateEl.textContent = stateLabel(data.state);
    stateEl.className = 'font-mono ' + stateColor(data.state);

    var provEl = document.getElementById('card-provenance');
    provEl.textContent = provenanceLabel(data.keyProvenance);
    provEl.className = 'font-mono ' + provenanceColor(data.keyProvenance);

    if (data.keyLabel) {
      document.getElementById('key-label-row').classList.remove('hidden');
      document.getElementById('card-key-label').textContent = data.keyLabel;
    } else {
      document.getElementById('key-label-row').classList.add('hidden');
    }

    if (data.activeVersion && data.activeVersion > 1) {
      document.getElementById('version-row').classList.remove('hidden');
      document.getElementById('card-version').textContent = data.activeVersion;
    } else {
      document.getElementById('version-row').classList.add('hidden');
    }

    if (data.paymentMethodLabel) {
      document.getElementById('method-row').classList.remove('hidden');
      document.getElementById('card-method').textContent = data.paymentMethodLabel;
    } else {
      document.getElementById('method-row').classList.add('hidden');
    }

    var balEl = document.getElementById('card-balance');
    var newBalance = data.balance || 0;
    animateBalance(balEl, previousBalance, newBalance);
    previousBalance = newBalance;

    if (data.activatedAt) {
      var fmtAct = formatTime(data.activatedAt);
      if (fmtAct) {
        document.getElementById('activated-row').classList.remove('hidden');
        document.getElementById('card-activated').textContent = fmtAct;
      } else {
        document.getElementById('activated-row').classList.add('hidden');
      }
    } else {
      document.getElementById('activated-row').classList.add('hidden');
    }

    if (data.firstSeenAt) {
      var formattedFirstSeen = formatTime(data.firstSeenAt);
      if (formattedFirstSeen) {
        document.getElementById('first-seen-row').classList.remove('hidden');
        document.getElementById('card-first-seen').textContent = formattedFirstSeen;
      } else {
        document.getElementById('first-seen-row').classList.add('hidden');
      }
    } else {
      document.getElementById('first-seen-row').classList.add('hidden');
    }

    if (data.programmingRecommended) {
      document.getElementById('provenance-banner').classList.remove('hidden');
      if (data.uid) {
        document.getElementById('activate-link').href = '/experimental/activate?uid=' + encodeURIComponent(data.uid);
      }
    } else {
      document.getElementById('provenance-banner').classList.add('hidden');
    }

    if (data.analytics && data.analytics.totalTaps > 0) {
      document.getElementById('analytics-section').classList.remove('hidden');
      document.getElementById('analytics-spent').textContent = formatBalance(data.analytics.completedMsat || 0);
      document.getElementById('analytics-taps').textContent = data.analytics.totalTaps;
      var rate = data.analytics.totalTaps > 0 ? Math.round((data.analytics.completedTaps / data.analytics.totalTaps) * 100) : 0;
      document.getElementById('analytics-rate').textContent = rate + '%';
    } else {
      document.getElementById('analytics-section').classList.add('hidden');
    }

    renderHistory(data.history);

    var canLock = data.state === 'active' || data.state === 'discovered';
    if (canLock) {
      document.getElementById('lock-section').classList.remove('hidden');
    } else {
      document.getElementById('lock-section').classList.add('hidden');
    }
    document.getElementById('lock-confirm').classList.add('hidden');
    document.getElementById('lock-status').classList.add('hidden');

    var isTerminated = data.state === 'terminated';
    if (isTerminated && data.reactivationAvailable) {
      document.getElementById('reactivate-section').classList.remove('hidden');
      var nextVer = (data.currentVersion || 1) + 1;
      document.getElementById('reactivate-version').textContent = nextVer;
      document.getElementById('reactivate-success').classList.add('hidden');
      document.getElementById('reactivate-scan').classList.remove('hidden');
      document.getElementById('reactivate-scan-status').textContent = '';
      document.getElementById('reactivate-scan-error').classList.add('hidden');
    } else {
      document.getElementById('reactivate-section').classList.add('hidden');
    }

    var newUrl = window.location.pathname + '?p=' + encodeURIComponent(p) + '&c=' + encodeURIComponent(c);
    window.history.replaceState(null, '', newUrl);

    // Show install banner if prompt is available
    if (deferredPrompt) {
      document.getElementById('install-banner').classList.remove('hidden');
    }

    document.getElementById('card-info').focus();
   } catch (err) {
     if (typeof window.reportClientError === 'function') window.reportClientError(err, 'card-dashboard.js:load-info');
     hideLoading();
     showError('Failed to load card info. Please try again.');
   }
}

function showError(msg) {
  document.getElementById('error-display').classList.remove('hidden');
  document.getElementById('error-message').textContent = msg;
}

function resetView() {
  document.getElementById('scan-section').classList.remove('hidden');
  document.getElementById('card-info').classList.add('hidden');
  document.getElementById('error-display').classList.add('hidden');
  document.getElementById('loading').classList.add('hidden');
  document.getElementById('scan-error').classList.add('hidden');
  document.getElementById('saved-card').classList.add('hidden');
  lastP = null;
  lastC = null;
  lastLoadTime = null;
  if (staleTimer) { clearInterval(staleTimer); staleTimer = null; }
}

function extractParams(url) {
  try {
    var u = new URL(url);
    var p = u.searchParams.get('p');
    var c = u.searchParams.get('c');
    if (p && c) return { p: p, c: c };
  } catch (e) {}
  return null;
}

var cardScanner = createNfcScanner({
  continuous: false,
  debounceMs: 0,
  onStatus: function(status) {
    if (status === 'scanning') {
      document.getElementById('scan-status').textContent = 'Ready \\u2014 tap your card now...';
    } else if (status === 'stopped') {
      document.getElementById('scan-status').textContent = 'Hold your card to the back of your phone';
    }
  },
  onError: function(err, phase) {
    var scanError = document.getElementById('scan-error');
    if (phase === 'permission') {
      document.getElementById('nfc-unsupported').classList.remove('hidden');
      scanError.classList.add('hidden');
    } else {
      scanError.textContent = 'NFC error: ' + (err.message || 'unknown');
      scanError.classList.remove('hidden');
    }
  },
  onTap: function(data) {
    if (!data.url) {
      var scanError = document.getElementById('scan-error');
      scanError.textContent = 'Card did not contain a valid bolt card URL';
      scanError.classList.remove('hidden');
      return;
    }
    var params = extractParams(data.url);
    if (params) {
      document.getElementById('scan-error').classList.add('hidden');
      showCardInfo(params.p, params.c);
    } else {
      var scanError = document.getElementById('scan-error');
      scanError.textContent = 'Card did not contain a valid bolt card URL';
      scanError.classList.remove('hidden');
    }
  }
});

document.getElementById('btn-scan-again').addEventListener('click', function() {
  resetView();
  cardScanner.restart();
});

var nfcStartBtn = document.getElementById('nfc-start-btn');
if (nfcStartBtn) {
  nfcStartBtn.addEventListener('click', function() {
    nfcStartBtn.classList.add('hidden');
    cardScanner.scan();
  });
}

document.getElementById('btn-load-url').addEventListener('click', function() {
  var input = document.getElementById('url-input').value.trim();
  var urlError = document.getElementById('url-error');
  urlError.classList.add('hidden');
  if (!input) {
    urlError.textContent = 'Please enter a card URL';
    urlError.classList.remove('hidden');
    return;
  }
  var params = extractParams(input);
  if (!params) {
    urlError.textContent = 'URL must contain p and c parameters';
    urlError.classList.remove('hidden');
    return;
  }
  resetView();
  showCardInfo(params.p, params.c);
});

document.getElementById('url-input').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') document.getElementById('btn-load-url').click();
});

document.getElementById('btn-refresh').addEventListener('click', function() {
  if (lastP && lastC) showCardInfo(lastP, lastC);
});

document.getElementById('btn-retry').addEventListener('click', function() {
  resetView();
  cardScanner.restart();
});

document.getElementById('btn-lock').addEventListener('click', function() {
  document.getElementById('lock-confirm').classList.remove('hidden');
});

document.getElementById('btn-lock-cancel').addEventListener('click', function() {
  document.getElementById('lock-confirm').classList.add('hidden');
});

document.getElementById('btn-lock-confirm').addEventListener('click', async function() {
  if (!lastP || !lastC) return;
  var btn = document.getElementById('btn-lock-confirm');
  btn.disabled = true;
  btn.textContent = 'Terminating...';
  try {
    var resp = await fetch('/api/card/lock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ p: lastP, c: lastC }),
    });
    var data = await resp.json();
    if (resp.ok && data.success) {
      document.getElementById('lock-confirm').classList.add('hidden');
      document.getElementById('btn-lock').disabled = true;
      document.getElementById('btn-lock').textContent = 'Card Terminated';
      document.getElementById('btn-lock').classList.remove('hover:bg-red-800/50');
      document.getElementById('lock-status').classList.remove('hidden');
      document.getElementById('lock-status').className = 'mt-2 text-center text-sm text-red-400';
      document.getElementById('lock-status').textContent = 'Your card has been terminated.';
      var stateEl = document.getElementById('card-state');
      stateEl.textContent = stateLabel('terminated');
      stateEl.className = 'font-mono ' + stateColor('terminated');
    } else {
      document.getElementById('lock-status').classList.remove('hidden');
      document.getElementById('lock-status').className = 'mt-2 text-center text-sm text-red-400';
      document.getElementById('lock-status').textContent = data.reason || data.error || 'Terminate failed';
      btn.disabled = false;
  btn.textContent = 'Confirm Terminate';
    }
   } catch (err) {
     if (typeof window.reportClientError === 'function') window.reportClientError(err, 'card-dashboard.js:terminate');
     document.getElementById('lock-status').classList.remove('hidden');
     document.getElementById('lock-status').className = 'mt-2 text-center text-sm text-red-400';
     document.getElementById('lock-status').textContent = 'Network error';
     btn.disabled = false;
     btn.textContent = 'Confirm Terminate';
   }
});

var reactivateScanner = null;

function startReactivateScan() {
  if (reactivateScanner) {
    reactivateScanner.restart();
  } else if (browserSupportsNfc()) {
    reactivateScanner = createNfcScanner({
      continuous: false,
      debounceMs: 0,
      onStatus: function(status) {
        if (status === 'scanning') {
          document.getElementById('reactivate-scan-status').textContent = 'Tap your card now...';
        }
      },
      onError: function(err, phase) {
        var el = document.getElementById('reactivate-scan-error');
        if (phase === 'permission') {
          el.textContent = 'NFC not available. Use an operator to re-provision.';
        } else {
          el.textContent = 'NFC error: ' + (err.message || 'unknown');
        }
        el.classList.remove('hidden');
      },
      onTap: function(data) {
        if (!data.url) {
          document.getElementById('reactivate-scan-error').textContent = 'Card did not contain a valid URL';
          document.getElementById('reactivate-scan-error').classList.remove('hidden');
          return;
        }
        var params = extractParams(data.url);
        if (params) {
          document.getElementById('reactivate-scan-error').classList.add('hidden');
          document.getElementById('reactivate-scan-status').textContent = 'Verifying...';
          submitReactivate(params.p, params.c);
        } else {
          document.getElementById('reactivate-scan-error').textContent = 'Invalid card URL';
          document.getElementById('reactivate-scan-error').classList.remove('hidden');
        }
      }
    });
    reactivateScanner.scan();
  } else {
    document.getElementById('reactivate-scan-status').textContent = 'NFC not available on this device. Ask an operator to re-provision your card.';
  }
}

async function submitReactivate(p, c) {
  try {
    var resp = await fetch('/api/card/reactivate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ p: p, c: c }),
    });
    var data = await resp.json();
    if (resp.ok && data.success) {
      document.getElementById('reactivate-scan').classList.add('hidden');
      document.getElementById('reactivate-success').classList.remove('hidden');
      document.getElementById('reactivate-new-version').textContent = data.version;
      if (data.uid) {
        document.getElementById('reactivate-program-link').href = '/experimental/activate?uid=' + encodeURIComponent(data.uid);
      }
    } else {
      document.getElementById('reactivate-scan-status').textContent = '';
      document.getElementById('reactivate-scan-error').textContent = data.reason || data.error || 'Re-activation failed';
      document.getElementById('reactivate-scan-error').classList.remove('hidden');
    }
   } catch (err) {
     if (typeof window.reportClientError === 'function') window.reportClientError(err, 'card-dashboard.js:reactivate');
     document.getElementById('reactivate-scan-error').textContent = 'Network error';
     document.getElementById('reactivate-scan-error').classList.remove('hidden');
   }
}

(function init() {
  // Check URL params first
  var currentUrl = window.location.href;
  var params = extractParams(currentUrl);
  if (params) {
    showCardInfo(params.p, params.c);
    return;
  }

  // Check localStorage for saved card
  var saved = loadSavedParams();
  if (saved) {
    document.getElementById('saved-card').classList.remove('hidden');
    showCardInfo(saved.p, saved.c);
    return;
  }

  getNfcPermissionState().then(function(state) {
    if (state === 'granted') {
      cardScanner.scan();
    } else if (state === 'prompt') {
      var btn = document.getElementById('nfc-start-btn');
      if (btn) btn.classList.remove('hidden');
    } else {
      document.getElementById('nfc-unsupported').classList.remove('hidden');
    }
  });
})();`;
export const CARD_DASHBOARD_JS_HASH = "fdd3713fd4fd";

export const DEBUG_JS = `// debug.js — classic script (no import/export)
// Requires: nfc.js (esc, browserSupportsNfc, createNfcScanner)

(function() {
  var debugRoot = document.getElementById('debug-root');
  var BASE_URL = debugRoot ? debugRoot.getAttribute('data-base-url') : '';

  var lastP = null;
  var lastC = null;
  var lastIdentifyData = null;
  var wipeQrCode = null;
  var nfcScanner = null;

  var scanBtn = document.getElementById('nfc-scan-btn');
  var errorBox = document.getElementById('error-message');

  function showError(msg) {
    errorBox.textContent = msg;
    errorBox.classList.remove('hidden');
  }
  function clearError() {
    errorBox.textContent = '';
    errorBox.classList.add('hidden');
  }

  function _el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function _kv(label, value, valueCls, labelCls) {
    var d = document.createElement('div');
    d.appendChild(_el('span', labelCls || 'font-semibold text-gray-100', label));
    if (valueCls) {
      d.appendChild(document.createTextNode(' '));
      var s = _el('span', valueCls);
      s.textContent = value;
      d.appendChild(s);
    } else {
      d.appendChild(document.createTextNode(' ' + value));
    }
    return d;
  }

  function updateScanBtn(state) {
    if (state === 'scanning') {
      scanBtn.textContent = 'Scanning\\u2026';
      scanBtn.className = 'ml-auto rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-300 transition hover:border-emerald-500/50';
    } else if (state === 'error') {
      scanBtn.textContent = 'Restart NFC scan';
      scanBtn.className = 'ml-auto rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs font-semibold text-red-300 transition hover:border-red-500/50';
    } else {
      scanBtn.textContent = 'Start NFC scan';
      scanBtn.className = 'ml-auto rounded-lg border border-gray-700 bg-gray-950 px-3 py-1.5 text-xs font-semibold text-gray-300 transition hover:border-cyan-500/50 hover:text-cyan-300';
    }
  }

  function setCardInfo(data) {
    document.getElementById('ci-uid').textContent = data.uid || '--';
    document.getElementById('ci-counter').textContent = data.counter || '--';
    document.getElementById('ci-issuer').textContent = data.issuer || '--';
    document.getElementById('ci-version').textContent = data.version != null ? data.version : '--';
    document.getElementById('ci-state').textContent = data.state || '--';
    document.getElementById('ci-method').textContent = data.method || '--';
    document.getElementById('ci-fingerprint').textContent = data.fingerprint || '--';
    document.getElementById('ci-cmac').textContent = data.cmac || '--';
    if (data.cmac === 'valid') {
      document.getElementById('ci-cmac').className = 'font-mono text-xs text-emerald-400';
    } else if (data.cmac === 'invalid') {
      document.getElementById('ci-cmac').className = 'font-mono text-xs text-red-400';
    } else {
      document.getElementById('ci-cmac').className = 'font-mono text-xs';
    }
  }

  function switchTab(tabId) {
    document.querySelectorAll('.debug-tab').forEach(function(t) { t.classList.toggle('active', t.dataset.tab === tabId); });
    document.querySelectorAll('.debug-panel').forEach(function(p) { p.classList.toggle('hidden', p.id !== 'panel-' + tabId); });
  }

  function initTabs() {
    document.querySelectorAll('.debug-tab').forEach(function(t) {
      t.addEventListener('click', function() { switchTab(t.dataset.tab); });
    });
    var hash = location.hash.replace('#', '');
    if (hash && document.getElementById('panel-' + hash)) switchTab(hash);
  }

  function initNfc() {
    if (!browserSupportsNfc()) {
      updateScanBtn('error');
      scanBtn.textContent = 'Web NFC unavailable';
      scanBtn.disabled = true;
      return;
    }

    nfcScanner = createNfcScanner({
      onTap: handleNfcTap,
      onError: function(err, phase) {
        if (phase === 'permission') {
          updateScanBtn('error');
          showError('NFC permission denied. Click the button to retry.');
        } else if (phase === 'scan') {
          showError('NFC read error: ' + err.message);
        } else {
          showError('Error: ' + err.message);
        }
      },
      onStatus: function(status) {
        if (status === 'scanning') updateScanBtn('scanning');
        else if (status === 'stopped') updateScanBtn('error');
        else if (status === 'starting') updateScanBtn('scanning');
      },
      debounceMs: 3000
    });

    scanBtn.addEventListener('click', function() {
      clearError();
      if (nfcScanner.isActive()) {
        nfcScanner.restart();
      } else {
        nfcScanner.scan();
      }
    });
  }

  function handleNfcTap(tap) {
    clearError();
    var uid = tap.serial || null;
    var nfcUrl = tap.url;
    var p = null, c = null;

    if (nfcUrl) {
      try {
        var u = new URL(nfcUrl);
        p = u.searchParams.get('p');
        c = u.searchParams.get('c');
      } catch (e) {}
    }

    lastP = p;
    lastC = c;

    var activePanel = document.querySelector('.debug-panel:not(.hidden)');
    if (!activePanel) return;
    var tabId = activePanel.id.replace('panel-', '');

    var handlers = {
      console: handleConsoleTab,
      identify: handleIdentifyTab,
      wipe: handleWipeTab,
      twofa: handleTwofaTab,
      identity: handleIdentityTab,
      pos: handlePosTab
    };
    if (handlers[tabId]) handlers[tabId]({ uid: uid, nfcUrl: nfcUrl, p: p, c: c });
  }

  function handleConsoleTab(data) {
    var ndefBox = document.getElementById('console-ndef');
    var detailsBox = document.getElementById('console-lnurlw-details');
    var payBtn = document.getElementById('console-pay-btn');
    var statusBox = document.getElementById('console-payment-status');

    if (!data.nfcUrl) {
      ndefBox.textContent = 'No NDEF records (blank or unprogrammed card)';
      detailsBox.replaceChildren(_el('span', 'text-gray-500', 'No LNURLW payload found.'));
      payBtn.classList.add('hidden');
      statusBox.classList.add('hidden');
      return;
    }

    ndefBox.textContent = data.nfcUrl;
    payBtn.classList.add('hidden');
    statusBox.classList.add('hidden');

    if (data.nfcUrl.startsWith('https://')) {
      fetch(data.nfcUrl).then(function(r) { return r.json(); }).then(function(json) {
        if (json.tag === 'withdrawRequest') {
          var _w = _el('div', 'space-y-1 text-sm');
          _w.appendChild(_kv('Callback:', json.callback, 'break-all font-mono text-xs text-cyan-300'));
          _w.appendChild(_kv('K1:', json.k1, 'break-all font-mono text-xs text-amber-300'));
          _w.appendChild(_kv('Min:', (json.minWithdrawable / 1000) + ' sats'));
          _w.appendChild(_kv('Max:', (json.maxWithdrawable / 1000) + ' sats'));
          detailsBox.replaceChildren(_w);
          payBtn.classList.remove('hidden');
          payBtn.disabled = false;
          window._consoleCallbackUrl = json.callback;
          window._consoleK1 = json.k1;
        } else {
          detailsBox.textContent = 'The card did not return a withdrawRequest payload.';
        }
      }).catch(function(e) {
        if (typeof window.reportClientError === 'function') window.reportClientError(e, 'debug.js:console-fetch');
        detailsBox.textContent = 'Error fetching LNURLW response: ' + e.message;
      });
    }
  }

  function handleIdentifyTab(data) {
    var detailsBox = document.getElementById('identify-details');
    var rawBox = document.getElementById('identify-raw');

    if (!data.p || !data.c) {
      detailsBox.replaceChildren(_el('p', 'text-gray-500', 'No card data available.'));
      rawBox.textContent = '--';
      return;
    }

    detailsBox.replaceChildren(_el('p', 'text-gray-500 animate-pulse', 'Identifying\\u2026'));
    fetch('/api/identify-card', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ p: data.p, c: data.c }),
    }).then(function(r) { return r.json(); }).then(function(json) {
      lastIdentifyData = json;
      rawBox.textContent = JSON.stringify(json, null, 2);

      if (json.status === 'ERROR') {
        detailsBox.replaceChildren(_el('p', 'text-red-300', json.reason || 'Identification failed'));
        return;
      }

      if (json.matched) {
        var m = json.matched;
        var _w = _el('div', 'space-y-2 text-sm');
        _w.appendChild(_kv('UID:', json.uid || '--', 'font-mono text-amber-300'));
        _w.appendChild(_kv('Counter:', json.counter || '--', 'font-mono text-cyan-300'));
        _w.appendChild(_kv('CMAC:', 'valid', 'text-emerald-300'));
        _w.appendChild(_kv('State:', m.card_state || '--'));
        _w.appendChild(_kv('Method:', m.payment_method || '--'));
        _w.appendChild(_kv('Version:', m.version != null ? String(m.version) : '--'));
        _w.appendChild(_kv('Source:', m.source === 'config' ? 'Known card' : 'Deterministic'));
        detailsBox.replaceChildren(_w);

        setCardInfo({
          uid: json.uid,
          counter: json.counter,
          state: m.card_state,
          method: m.payment_method,
          issuer: m.issuerKeyFingerprint ? m.issuerKeyFingerprint.slice(0, 8) + '...' : '--',
          version: m.version != null ? m.version : '--',
          fingerprint: m.issuerKeyFingerprint || '--',
          cmac: 'valid',
        });
      } else {
        var _w2 = _el('div', 'space-y-2 text-sm');
        _w2.appendChild(_kv('UID:', json.uid || '--', 'font-mono text-amber-300'));
        _w2.appendChild(_kv('Counter:', json.counter || '--', 'font-mono text-cyan-300'));
        _w2.appendChild(_kv('CMAC:', 'no match', 'text-red-300'));
        var _att = _el('div', 'text-xs text-gray-500 mt-2');
        _att.textContent = 'Tried ' + ((json.all_attempts && json.all_attempts.length) || 0) + ' key(s). None matched CMAC.';
        _w2.appendChild(_att);
        detailsBox.replaceChildren(_w2);

        setCardInfo({
          uid: json.uid,
          counter: json.counter,
          cmac: 'invalid',
        });
      }
      }).catch(function(err) {
        if (typeof window.reportClientError === 'function') window.reportClientError(err, 'debug.js:identify-fetch');
        detailsBox.replaceChildren(_el('p', 'text-red-300', 'Error: ' + err.message));
      });
  }

  function handleWipeTab(data) {
    var statusDiv = document.getElementById('wipe-status');
    var generateBtn = document.getElementById('wipe-generate-btn');
    var outputDiv = document.getElementById('wipe-output');
    var actionsDiv = document.getElementById('wipe-actions');

    if (!data.uid || data.uid === 'blank') {
      statusDiv.textContent = 'No card detected. Tap a card first.';
      generateBtn.classList.add('hidden');
      outputDiv.classList.add('hidden');
      actionsDiv.classList.add('hidden');
      return;
    }

    statusDiv.textContent = 'Card detected: ' + data.uid.toUpperCase();
    generateBtn.classList.remove('hidden');
    generateBtn.disabled = false;
    outputDiv.classList.add('hidden');
    actionsDiv.classList.add('hidden');

    generateBtn.onclick = function() {
      generateBtn.disabled = true;
      generateBtn.textContent = 'Generating\\u2026';
      fetch(BASE_URL + '/wipe?uid=' + encodeURIComponent(data.uid))
        .then(function(r) { return r.json(); })
        .then(function(json) {
          outputDiv.classList.remove('hidden');
          var resultDiv = document.getElementById('wipe-result');

          if (json.reset_deeplink) {
            resultDiv.textContent = 'Keys generated successfully.';
            var deeplink = json.reset_deeplink;
            document.getElementById('wipe-deeplink').href = deeplink;
            document.getElementById('wipe-deeplink').textContent = deeplink;

            if (wipeQrCode) { wipeQrCode.clear(); wipeQrCode = null; }
            var qrContainer = document.getElementById('wipe-qr');
            qrContainer.replaceChildren();
            wipeQrCode = new QRCode(qrContainer, { text: deeplink, width: 200, height: 200, colorDark: '#000000', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.L });
            actionsDiv.classList.remove('hidden');
          } else {
            resultDiv.textContent = json.reason || 'Failed to generate wipe data.';
          }
        }).catch(function(err) {
          if (typeof window.reportClientError === 'function') window.reportClientError(err, 'debug.js:wipe-fetch');
          var resultDiv = document.getElementById('wipe-result');
          resultDiv.textContent = 'Error: ' + err.message;
        });
      generateBtn.textContent = 'Generate Wipe Data';
      generateBtn.disabled = false;
    };
  }

  function handleTwofaTab(data) {
    var outputDiv = document.getElementById('twofa-output');
    if (!data.p || !data.c) {
      outputDiv.replaceChildren(_el('div', 'text-center text-gray-500 py-4', 'Tap a card to load 2FA codes.'));
      return;
    }
    outputDiv.replaceChildren(_el('div', 'text-center text-gray-500 py-4 animate-pulse', 'Loading\\u2026'));
    fetch(BASE_URL + '/2fa?p=' + encodeURIComponent(data.p) + '&c=' + encodeURIComponent(data.c), {
      headers: { 'Accept': 'application/json' }
    })
      .then(function(r) { return r.json(); })
      .then(function(json) {
        if (json.totpCode) {
          var _w = _el('div', 'space-y-4 text-center');
          var _td = _el('div');
          _td.appendChild(_el('p', 'text-xs text-gray-500 uppercase tracking-wider mb-1', 'TOTP'));
          _td.appendChild(_el('p', 'text-2xl font-mono text-emerald-400', json.totpCode));
          _td.appendChild(_el('p', 'text-xs text-gray-500 mt-1', String(json.totpSecondsRemaining) + 's remaining'));
          _w.appendChild(_td);
          var _hd = _el('div');
          _hd.appendChild(_el('p', 'text-xs text-gray-500 uppercase tracking-wider mb-1', 'HOTP'));
          _hd.appendChild(_el('p', 'text-2xl font-mono text-blue-400', json.hotpCode));
          _hd.appendChild(_el('p', 'text-xs text-gray-500 mt-1', 'Counter: ' + String(json.counterValue)));
          _w.appendChild(_hd);
          _w.appendChild(_el('p', 'text-xs text-gray-500 font-mono', 'UID: ' + (json.maskedUid || json.uidHex || '--')));
          outputDiv.replaceChildren(_w);
        } else {
          outputDiv.replaceChildren(_el('div', 'text-center text-red-400 py-4', json.reason || json.error || 'Error'));
        }
      })
      .catch(function() {
        if (typeof window.reportClientError === 'function') window.reportClientError(new Error('2FA data load failed'), 'debug.js:twofa-fetch');
        outputDiv.replaceChildren(_el('div', 'text-center text-red-400 py-4', 'Error loading 2FA data.'));
      });
  }

  function handleIdentityTab(data) {
    var outputDiv = document.getElementById('identity-output');
    if (!data.p || !data.c) {
      outputDiv.replaceChildren(_el('div', 'text-center text-gray-500 py-4', 'Tap a card to verify identity.'));
      return;
    }
    outputDiv.replaceChildren(_el('div', 'text-center text-gray-500 py-4 animate-pulse', 'Verifying\\u2026'));
    fetch(BASE_URL + '/api/verify-identity?p=' + encodeURIComponent(data.p) + '&c=' + encodeURIComponent(data.c))
      .then(function(r) { return r.json(); })
      .then(function(json) {
        if (json.verified) {
          var _outer = _el('div', 'rounded-xl border border-pink-500/20 bg-pink-500/5 p-4 mt-4');
          var _flex = _el('div', 'flex items-center gap-3 mb-3');
          var _emoji = _el('div', 'h-8 w-8 rounded-full bg-pink-500 flex items-center justify-center text-xl');
          _emoji.textContent = (json.profile && json.profile.emoji) || '?';
          _flex.appendChild(_emoji);
          var _info = _el('div');
          var _name = _el('div', 'font-bold text-white text-lg');
          _name.textContent = (json.profile && json.profile.name) || 'Unknown';
          _info.appendChild(_name);
          var _role = _el('div', 'text-xs text-gray-400');
          _role.textContent = (json.profile && json.profile.role || '') + ' \\u00b7 ' + (json.profile && json.profile.department || '');
          _info.appendChild(_role);
          _flex.appendChild(_info);
          _outer.appendChild(_flex);
          var _grid = _el('div', 'grid grid-cols-2 gap-2 text-sm');
          _grid.appendChild(_kv('UID:', json.uid || '--', 'font-mono text-amber-300', 'text-gray-500'));
          _grid.appendChild(_kv('Clearance:', (json.profile && json.profile.clearance) || '--', 'text-pink-300', 'text-gray-500'));
          _outer.appendChild(_grid);
          outputDiv.replaceChildren(_outer);
        } else {
          var _denied = _el('div', 'rounded-xl border border-red-500/30 bg-red-500/10 p-4 mt-4');
          _denied.appendChild(_el('p', 'text-red-300', json.reason || 'Not verified'));
          outputDiv.replaceChildren(_denied);
        }
      }).catch(function() {
        if (typeof window.reportClientError === 'function') window.reportClientError(new Error('Identity data load failed'), 'debug.js:identity-fetch');
        outputDiv.replaceChildren(_el('div', 'text-center text-red-400 py-4', 'Error loading identity data.'));
      });
  }

  function handlePosTab(data) {
    var chargeBtn = document.getElementById('pos-charge-btn');
    var statusBox = document.getElementById('pos-status');

    if (!data.p || !data.c) {
      chargeBtn.classList.add('hidden');
      statusBox.classList.add('hidden');
      return;
    }

    chargeBtn.classList.remove('hidden');
    chargeBtn.disabled = false;
    statusBox.classList.add('hidden');
    document.getElementById('pos-amount').focus();
  }

  function showPosStatus(msg, ok) {
    var statusBox = document.getElementById('pos-status');
    statusBox.textContent = msg;
    statusBox.className = ok
      ? 'mt-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm font-semibold text-emerald-200'
      : 'mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-200';
    statusBox.classList.remove('hidden');
  }

  function handleManualUrl() {
    var input = document.getElementById('manual-url');
    var url = input.value.trim();
    if (!url) return;
    try {
      var u = new URL(url);
      var p = u.searchParams.get('p');
      var c = u.searchParams.get('c');
      if (!p || !c) { showError('URL must contain p and c parameters'); return; }
      input.value = '';
      clearError();
      var activePanel = document.querySelector('.debug-panel:not(.hidden)');
      if (!activePanel) return;
      var tabId = activePanel.id.replace('panel-', '');
      var handlers = {
        console: handleConsoleTab,
        identify: handleIdentifyTab,
        wipe: handleWipeTab,
        twofa: handleTwofaTab,
        identity: handleIdentityTab,
        pos: handlePosTab
      };
      lastP = p;
      lastC = c;
      if (handlers[tabId]) handlers[tabId]({ uid: null, nfcUrl: url, p: p, c: c });
    } catch (e) { showError('Invalid URL format'); }
  }

  // Event delegation for data-action buttons
  document.addEventListener('click', function(e) {
    var btn = e.target.closest('[data-action]');
    if (!btn) return;
    var action = btn.getAttribute('data-action');
    if (action === 'copy-wipe-deeplink') {
      var link = document.getElementById('wipe-deeplink');
      if (link) {
        navigator.clipboard.writeText(link.href).then(function() {
          var t = document.getElementById('wipe-copy-toast');
          if (t) {
            t.classList.remove('translate-y-20', 'opacity-0');
            setTimeout(function() { t.classList.add('translate-y-20', 'opacity-0'); }, 2000);
          }
        });
      }
    }
  });

  // POS charge button
  document.getElementById('pos-charge-btn').addEventListener('click', function() {
    if (!lastP || !lastC) return;
    var amount = parseInt(document.getElementById('pos-amount').value, 10);
    if (!amount || amount <= 0) { showPosStatus('Enter a valid amount', false); return; }
    var chargeBtn = document.getElementById('pos-charge-btn');
    chargeBtn.disabled = true;
    fetch(BASE_URL + '/operator/pos/charge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ p: lastP, c: lastC, amount: amount }),
    }).then(function(r) { return r.json(); }).then(function(json) {
      showPosStatus(json.reason || (json.status === 'OK' ? 'Charged ' + amount + ' credits' : 'Charge failed'), json.status === 'OK');
     }).catch(function(err) {
        if (typeof window.reportClientError === 'function') window.reportClientError(err, 'debug.js:pos-charge-fetch');
        showPosStatus('Error: ' + err.message, false);
      });
    chargeBtn.disabled = false;
  });

  // Console toggle JSON
  document.getElementById('console-toggle-json').addEventListener('click', function() {
    var jsonBox = document.getElementById('console-json');
    jsonBox.classList.toggle('hidden');
    this.textContent = jsonBox.classList.contains('hidden') ? 'Show raw JSON' : 'Hide raw JSON';
  });

  // Manual URL input
  document.getElementById('manual-load-btn').addEventListener('click', handleManualUrl);
  document.getElementById('manual-url').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') handleManualUrl();
  });

  // Initialize
  initTabs();
  initNfc();

  var nfcStatusEl = document.getElementById('nfc-status');
  if (nfcStatusEl) {
    if (!browserSupportsNfc()) {
      nfcStatusEl.classList.remove('hidden');
      nfcStatusEl.textContent = 'Web NFC not available in this browser. Use the manual URL input below.';
    }
  }

  var activePanel = document.querySelector('.debug-panel:not(.hidden)');
  if (activePanel && activePanel.id === 'panel-console' && nfcScanner) {
    canAutoStartNfc().then(function(granted) {
      if (granted) nfcScanner.scan();
    });
  }
})();`;
export const DEBUG_JS_HASH = "ade116ecd028";

export const LOGIN_JS = `// login.js — classic script (no import/export)
// Depends on: nfc.js, helpers.js, card-info.js, card-actions.js, programming.js

(function() {
  // Read server config from data attributes
  var loginView = document.getElementById('login-view');
  var API_HOST = loginView ? loginView.getAttribute('data-api-host') : '';
  var DEFAULT_PROGRAMMING_ENDPOINT = loginView ? loginView.getAttribute('data-default-endpoint') : '';

  // State
  var loginTime = null;
  var timerInterval = null;
  var scanner = createNfcScanner({
    continuous: true,
    debounceMs: 3000,
    prefixes: ['lnurlw://', 'lnurlp://', 'https://'],
    onTap: function(tap) {
      clearErrors();
      var statusEl = document.getElementById('scan-status');
      if (tap.url) {
        showNdef(tap.url);
        statusEl.textContent = 'Card detected! Verifying...';
        try {
          var urlObj = new URL(tap.url);
          var p = urlObj.searchParams.get('p');
          var c = urlObj.searchParams.get('c');
          if (p && c) {
            validateWithServer(p, c).then(function(result) {
              if (result.success) {
                if (!result.deployed && !result.public) {
                  showUndeployedCard(result);
                } else if (result.public) {
                  showPublicCard(result);
                } else {
                  showPrivateCard(result);
                }
                scanner.stop();
              } else {
                showPersistentError(result.error || result.reason || 'Authentication failed');
                statusEl.textContent = 'Failed. Tap card to retry.';
              }
            }).catch(function(e) {
              if (typeof window.reportClientError === 'function') window.reportClientError(e, 'login.js:validate-server');
              showPersistentError('Validation error: ' + e.message);
              statusEl.textContent = 'Error. Tap to retry.';
            });
          } else {
            showPersistentError('Card URL missing p/c parameters. Raw: ' + tap.url);
            statusEl.textContent = 'Invalid card. Tap to retry.';
          }
        } catch(e) {
          if (typeof window.reportClientError === 'function') window.reportClientError(e, 'login.js:parse-url');
          showPersistentError('Could not parse card URL: ' + e.message + '. Raw: ' + tap.url);
          statusEl.textContent = 'Parse error. Tap to retry.';
        }
      }
      if (!tap.url && tap.serial) {
        var uid = tap.serial;
        if (/^[0-9a-f]{14}$/.test(uid)) {
          showNdef('No NDEF record found. UID: ' + uid.toUpperCase());
          statusEl.textContent = 'Card detected! Reading UID...';
          validateUid(uid).then(function(result) {
            if (result.success) {
              if (result.deployed) {
                if (result.cardState === 'terminated') {
                  showTerminatedCard(result);
                } else if (result.cardState === 'wipe_requested') {
                  autoConfirmWipe(result);
                } else if (result.cardState === 'active') {
                  showWipedCard(result);
                } else {
                  showPrivateCard(result);
                }
              } else {
                showUndeployedCard(result);
              }
              scanner.stop();
            } else {
              showPersistentError(result.error || result.reason || 'UID lookup failed');
              statusEl.textContent = 'Failed. Tap card to retry.';
            }
          }).catch(function(e) {
            if (typeof window.reportClientError === 'function') window.reportClientError(e, 'login.js:uid-lookup');
            showPersistentError('UID lookup error: ' + e.message);
            statusEl.textContent = 'Error. Tap to retry.';
          });
        }
      }
    },
    onError: function(error, phase) {
      if (typeof window.reportClientError === 'function') window.reportClientError(error, 'login.js:nfc-' + phase);
      var statusEl = document.getElementById('scan-status');
      if (phase === 'permission') {
        if (error.name === 'NotAllowedError') {
          statusEl.textContent = 'NFC permission denied';
          showPersistentError('NFC permission was denied. Refresh the page and allow NFC access.');
        } else if (error.name === 'NotSupportedError') {
          statusEl.textContent = 'NFC not available';
          showPersistentError('NFC is not available on this device. Use Chrome 89+ on Android.');
        } else {
          statusEl.textContent = 'NFC error';
          showPersistentError('NFC error: ' + error.message);
        }
      } else if (phase === 'scan') {
        if (scanner.isActive()) {
          statusEl.textContent = 'Read error. Tap card again.';
        } else {
          statusEl.textContent = 'NFC error';
          showPersistentError('NFC error: ' + error.message);
        }
      }
    },
    onStatus: function(status) {
      var statusEl = document.getElementById('scan-status');
      var indicatorEl = document.getElementById('nfc-indicator');
      if (status === 'scanning') {
        statusEl.textContent = 'Scanning... tap your card';
        indicatorEl.classList.remove('hidden');
      } else if (status === 'stopped') {
        indicatorEl.classList.add('hidden');
      }
    }
  });
  var currentUid = null;
  var currentProgrammingEndpoint = DEFAULT_PROGRAMMING_ENDPOINT;
  var currentUndeployedUid = null;
  var currentTerminatedUid = null;

  // Event delegation for data-action buttons
  document.addEventListener('click', function(e) {
    var btn = e.target.closest('[data-action]');
    if (!btn) return;
    var action = btn.getAttribute('data-action');
    switch (action) {
      case 'rescan': rescanCard(); break;
      case 'copy': copyElementText(btn.getAttribute('data-copy-target')); break;
      case 'copy-href': copyElementHref(btn.getAttribute('data-copy-target')); break;
      case 'copy-wipe': copyWipeJson(btn.getAttribute('data-target')); break;
      case 'copy-all-keys': copyAllKeys(btn.getAttribute('data-target')); break;
      case 'provision': provisionCard(); break;
      case 'reprovision': reprovisionCard(); break;
      case 'reprovision-private': reprovisionPrivateCard(); break;
      case 'fetch-wipe': fetchWipeKeys(); break;
      case 'topup': topUpBalance(); break;
      case 'confirm-wiped': confirmWipedCard(); break;
      case 'show-view': hideAllViews(); document.getElementById(btn.getAttribute('data-view')).classList.remove('hidden'); break;
    }
  });

  function copyElementText(id) {
    var el = document.getElementById(id);
    if (el) navigator.clipboard.writeText(el.textContent);
  }

  function copyElementHref(id) {
    var el = document.getElementById(id);
    if (el) navigator.clipboard.writeText(el.href);
  }

  if (!browserSupportsNfc()) {
    document.getElementById('nfc-not-supported').classList.remove('hidden');
    document.getElementById('nfc-ready').classList.add('hidden');
  } else {
    getNfcPermissionState().then(function(state) {
      if (state === 'granted') {
        scanner.scan();
      } else {
        var btn = document.getElementById('nfc-start-btn');
        if (btn) {
          btn.classList.remove('hidden');
          btn.addEventListener('click', function() {
            btn.classList.add('hidden');
            scanner.scan();
          });
        }
      }
    });
  }

  function startTimer() {
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(function() {
      if (loginTime) {
        document.getElementById('priv-timer').textContent = formatDuration(Date.now() - loginTime);
      }
    }, 1000);
  }

  function hideAllViews() {
    document.getElementById('login-view').classList.add('hidden');
    document.getElementById('undeployed-view').classList.add('hidden');
    document.getElementById('public-view').classList.add('hidden');
    document.getElementById('private-view').classList.add('hidden');
    document.getElementById('terminated-view').classList.add('hidden');
    document.getElementById('wiped-detection-view').classList.add('hidden');
  }

  function showPersistentError(msg) {
    var privView = document.getElementById('private-view');
    var pubView = document.getElementById('public-view');
    if (!privView.classList.contains('hidden')) {
      document.getElementById('private-error-msg').textContent = msg;
      document.getElementById('private-error-box').classList.remove('hidden');
    } else if (!pubView.classList.contains('hidden')) {
      document.getElementById('public-error-msg').textContent = msg;
      document.getElementById('public-error-box').classList.remove('hidden');
    } else {
      document.getElementById('error-msg').textContent = msg;
      document.getElementById('error-box').classList.remove('hidden');
    }
  }

  function clearErrors() {
    document.getElementById('error-box').classList.add('hidden');
    document.getElementById('public-error-box').classList.add('hidden');
    document.getElementById('private-error-box').classList.add('hidden');
  }

  function showNdef(url) {
    document.getElementById('ndef-raw').textContent = url;
    document.getElementById('last-ndef').classList.remove('hidden');
  }

  function typeBadgeClass(cardType) {
    return 'px-3 py-1 rounded text-xs font-bold border ' +
      (cardType === 'lnurlpay' ? 'bg-purple-500/10 text-purple-400 border-purple-500/30' :
       cardType === 'twofactor' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' :
       'bg-amber-500/10 text-amber-400 border-amber-500/30');
  }

  function copyWipeJson(prefix) {
    navigator.clipboard.writeText(buildWipeJson(prefix + '-keys'));
  }

  function copyAllKeys(target) {
    var tbody = document.getElementById(target);
    if (!tbody) return;
    var cells = tbody.querySelectorAll('td:last-child');
    var vals = Array.from(cells).map(function(t) { return t.textContent.trim(); });
    var obj = {k0: vals[0] || '', k1: vals[1] || '', k2: vals[2] || '', k3: vals[3] || '', k4: vals[4] || ''};
    navigator.clipboard.writeText(JSON.stringify(obj, null, 2));
  }

  function setCurrentProgrammingEndpoint(endpointUrl) {
    currentProgrammingEndpoint = endpointUrl || DEFAULT_PROGRAMMING_ENDPOINT;
  }

  function buildProgrammingEndpointUrl() {
    return currentProgrammingEndpoint || DEFAULT_PROGRAMMING_ENDPOINT;
  }

  function showUndeployedProgrammingInstructions(endpointUrl, deliveredAt) {
    var deeplink = buildProgrammingDeeplink(endpointUrl || buildProgrammingEndpointUrl());
    renderQrCode('qr-undep-program', deeplink);
    document.getElementById('undep-program-deeplink').href = deeplink;
    if (deliveredAt) {
      document.getElementById('undep-keys-delivered-time').textContent = 'Keys generated ' + relativeTime(Math.floor(deliveredAt / 1000)) + '.';
    } else {
      document.getElementById('undep-keys-delivered-time').textContent = '';
    }
    document.getElementById('undep-program-section').classList.remove('hidden');
    document.getElementById('undep-provision-btn').parentElement.classList.add('hidden');
  }

  function hideUndeployedProgrammingInstructions() {
    document.getElementById('undep-program-section').classList.add('hidden');
    document.getElementById('undep-provision-btn').parentElement.classList.remove('hidden');
  }

  function provisionCard() {
    if (!currentUndeployedUid) return;
    var btn = document.getElementById('undep-provision-btn');
    var status = document.getElementById('undep-provision-status');
    btn.disabled = true;
    btn.textContent = 'PROVISIONING...';
    btn.classList.add('opacity-50');
    status.classList.remove('hidden');
    status.className = 'mt-3 text-center text-sm text-gray-400';
    status.textContent = 'Writing keys to card...';

    var endpoint = buildProgrammingEndpointUrl();
    fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ UID: currentUndeployedUid }),
    }).then(function(resp) { return resp.json().then(function(data) { return { ok: resp.ok, data: data }; }); })
    .then(function(result) {
      if (result.ok) {
        status.className = 'mt-3 text-center text-sm text-emerald-400';
        status.textContent = 'Card provisioned! Version ' + (result.data.Version || 1) + '. Tap again to activate.';
        btn.textContent = 'PROVISIONED';
        btn.classList.remove('bg-emerald-600', 'hover:bg-emerald-500');
        btn.classList.add('bg-gray-600');
        showUndeployedProgrammingInstructions(endpoint, Date.now());
      } else {
        throw new Error(result.data.error || 'Provisioning failed');
      }
    }).catch(function(e) {
      if (typeof window.reportClientError === 'function') window.reportClientError(e, 'login.js:provision');
      status.className = 'mt-3 text-center text-sm text-red-400';
      if (e.message.includes('active') || e.message.includes('Terminate')) {
        status.textContent = 'This card is already active and working. Wipe it first if you want to re-provision.';
      } else {
        status.textContent = 'Error: ' + e.message;
      }
      btn.disabled = false;
      btn.textContent = 'PROVISION AS WITHDRAW CARD';
      btn.classList.remove('opacity-50');
    });
  }

  function showUndeployedCard(result) {
    clearErrors();
    hideAllViews();
    currentUndeployedUid = result.uidHex;
    setCurrentProgrammingEndpoint(result.programmingEndpoint);
    document.getElementById('undep-uid-display').textContent = 'UID: ' + result.uidHex.toUpperCase();
    document.getElementById('undep-version').textContent = result.keyVersion || 1;
    document.getElementById('undep-state').textContent = result.cardState || 'new';
    document.getElementById('undep-keys').replaceChildren(buildKeysRows(result.k0, result.k1, result.k2, result.k3, result.k4));
    var btn = document.getElementById('undep-provision-btn');
    btn.disabled = false;
    btn.textContent = 'PROVISION AS WITHDRAW CARD';
    btn.classList.remove('opacity-50', 'bg-gray-600');
    btn.classList.add('bg-emerald-600', 'hover:bg-emerald-500');
    document.getElementById('undep-provision-status').classList.add('hidden');
    if (result.awaitingProgramming) {
      showUndeployedProgrammingInstructions(result.programmingEndpoint, result.keysDeliveredAt);
    } else {
      hideUndeployedProgrammingInstructions();
    }
    document.getElementById('undeployed-view').classList.remove('hidden');
  }

  function showPublicCard(result) {
    clearErrors();
    hideAllViews();
    var cardType = result.cardType || 'unknown';
    var typeLabels = { fakewallet: 'WITHDRAW', lnurlpay: 'POS', twofactor: '2FA' };

    document.getElementById('pub-uid-display').textContent = 'UID: ' + result.uidHex.toUpperCase();
    document.getElementById('pub-card-type-badge').textContent = typeLabels[cardType] || cardType.toUpperCase();
    document.getElementById('pub-card-type-badge').className = typeBadgeClass(cardType);
    document.getElementById('pub-version').textContent = result.keyVersion || '-';
    document.getElementById('pub-state').textContent = result.cardState || '-';
    document.getElementById('pub-counter').textContent = result.counterValue;
    document.getElementById('pub-issuer').textContent = result.issuerKey || 'recovered';
    var cmacEl = document.getElementById('pub-cmac');
    cmacEl.textContent = result.cmacValid ? 'VERIFIED' : 'FAILED';
    cmacEl.className = result.cmacValid ? 'font-mono text-emerald-400' : 'font-mono text-red-400';
    document.getElementById('pub-keys').replaceChildren(buildKeysRows(result.k0, result.k1, result.k2, result.k3, result.k4));
    document.getElementById('pub-ndef').textContent = result.ndef || '';
    document.getElementById('public-view').classList.remove('hidden');
    renderTapHistory(result.tapHistory || [], 'pub');
    var pubUid = result.uidHex;
    var pubKeys = [result.k0, result.k1, result.k2, result.k3, result.k4];
    if (pubKeys[0] && pubKeys[1] && pubKeys[2] && pubKeys[3] && pubKeys[4]) {
      var endpointUrl = API_HOST + '/api/keys?uid=' + pubUid + '&format=boltcard';
      document.getElementById('pub-wipe-deeplink').href = 'boltcard://reset?url=' + encodeURIComponent(endpointUrl);
      var qrEl = document.getElementById('qr-pub-wipe');
      qrEl.replaceChildren();
      renderQrCode('qr-pub-wipe', buildWipeJson('pub-keys'));
    }
  }

  function showPrivateCard(result) {
    clearErrors();
    hideAllViews();
    currentUid = result.uidHex;
    setCurrentProgrammingEndpoint(result.programmingEndpoint);
    var cardType = result.cardType || 'unknown';
    var typeLabels = { fakewallet: 'WITHDRAW', lnurlpay: 'POS', twofactor: '2FA' };

    document.getElementById('priv-uid-display').textContent = 'UID: ' + result.uidHex.toUpperCase();
    document.getElementById('priv-card-type-badge').textContent = typeLabels[cardType] || cardType.toUpperCase();
    document.getElementById('priv-card-type-badge').className = typeBadgeClass(cardType);
    document.getElementById('priv-version').textContent = result.keyVersion || '-';
    document.getElementById('priv-state').textContent = result.cardState || '-';
    document.getElementById('priv-counter').textContent = result.counterValue;
    if (result.balance !== undefined) {
      document.getElementById('priv-balance').textContent = result.balance;
    }
    document.getElementById('priv-issuer').textContent = result.issuerKey || 'current';
    document.getElementById('topup-amount').value = '';
    document.getElementById('topup-status').classList.add('hidden');
    var cmacEl = document.getElementById('priv-cmac');
    cmacEl.textContent = result.cmacValid ? 'VERIFIED' : 'FAILED';
    cmacEl.className = result.cmacValid ? 'font-mono text-emerald-400' : 'font-mono text-red-400';
    document.getElementById('priv-debug-issuer').textContent = '-';
    document.getElementById('priv-debug-version').textContent = '-';
    document.getElementById('priv-debug-versions').textContent = '-';
    if (result.debug) {
      document.getElementById('priv-debug-issuer').textContent = result.debug.issuerKey || '-';
      document.getElementById('priv-debug-version').textContent = result.debug.matchedVersion || '-';
      if (result.debug.versionsTried && result.debug.versionsTried.length > 0) {
        document.getElementById('priv-debug-versions').textContent = result.debug.versionsTried.map(function(v) {
          return 'v' + v.version + ':' + (v.cmac ? 'OK' : 'FAIL');
        }).join(', ');
      }
    }
    document.getElementById('priv-keys').replaceChildren(buildKeysRows(result.k0, result.k1, result.k2, result.k3, result.k4));
    document.getElementById('priv-ndef').textContent = result.ndef || '';
    var privProgrammingSection = document.getElementById('priv-awaiting-programming');
    var terminatedBanner = document.getElementById('priv-terminated-banner');
    var wipeSection = document.getElementById('priv-wipe-section');
    var reprovisionBtn = document.getElementById('priv-reprovision-btn');
    reprovisionBtn.disabled = false;
    reprovisionBtn.textContent = 'RE-PROVISION CARD';
    reprovisionBtn.classList.remove('opacity-50', 'bg-gray-600');
    reprovisionBtn.classList.add('bg-emerald-600', 'hover:bg-emerald-500');
    document.getElementById('priv-reprovision-status').classList.add('hidden');
    document.getElementById('priv-reprovision-program').classList.add('hidden');
    if (result.cardState === 'keys_delivered' && result.programmingEndpoint) {
      var privProgramEndpoint = result.programmingEndpoint;
      var privDeeplink = 'boltcard://program?url=' + encodeURIComponent(privProgramEndpoint);
      renderQrCode('qr-priv-program', privDeeplink);
      document.getElementById('priv-program-deeplink').href = privDeeplink;
      if (result.keysDeliveredAt) {
        document.getElementById('priv-keys-delivered-time').textContent = 'Keys generated ' + relativeTime(Math.floor(result.keysDeliveredAt / 1000)) + '.';
      } else {
        document.getElementById('priv-keys-delivered-time').textContent = '';
      }
      privProgrammingSection.classList.remove('hidden');
      wipeSection.classList.add('hidden');
    } else {
      privProgrammingSection.classList.add('hidden');
    }

    if (result.cardState === 'terminated') {
      document.getElementById('priv-term-version').textContent = result.keyVersion || 1;
      terminatedBanner.classList.remove('hidden');
      wipeSection.classList.add('hidden');
    } else {
      terminatedBanner.classList.add('hidden');
    }

    document.getElementById('priv-wipe-version').textContent = 'v' + (result.keyVersion || 1);
    document.getElementById('priv-fetch-wipe-btn').disabled = false;
    document.getElementById('priv-fetch-wipe-btn').textContent = 'GET WIPE KEYS';
    document.getElementById('priv-fetch-wipe-btn').classList.remove('opacity-50', 'bg-gray-600');
    document.getElementById('priv-fetch-wipe-btn').classList.add('bg-red-600', 'hover:bg-red-500');
    document.getElementById('priv-wipe-status').classList.add('hidden');
    document.getElementById('priv-wipe-result').classList.add('hidden');
    if (result.cardState === 'active') {
      wipeSection.classList.remove('hidden');
    } else if (result.cardState === 'wipe_requested') {
      wipeSection.classList.remove('hidden');
      document.getElementById('priv-fetch-wipe-btn').textContent = 'WIPE KEYS ALREADY RETRIEVED';
      document.getElementById('priv-fetch-wipe-btn').disabled = true;
      document.getElementById('priv-fetch-wipe-btn').classList.remove('bg-red-600', 'hover:bg-red-500');
      document.getElementById('priv-fetch-wipe-btn').classList.add('bg-gray-600');
      var statusEl = document.getElementById('priv-wipe-status');
      statusEl.classList.remove('hidden');
      statusEl.className = 'mt-3 text-center text-sm text-amber-400';
      statusEl.textContent = 'Card is pending physical wipe. Tap card with blank NDEF to confirm.';
    } else {
      wipeSection.classList.add('hidden');
    }

    loginTime = Date.now();
    document.getElementById('priv-timer').textContent = '00:00:00';
    document.getElementById('private-view').classList.remove('hidden');
    renderTapHistory(result.tapHistory || [], 'priv');
    startTimer();
  }

  function showTerminatedCard(result) {
    clearErrors();
    hideAllViews();
    currentTerminatedUid = result.uidHex;
    setCurrentProgrammingEndpoint(result.programmingEndpoint);
    var prevVersion = result.keyVersion || 1;
    var nextVersion = prevVersion + 1;
    document.getElementById('term-uid-display').textContent = 'UID: ' + result.uidHex.toUpperCase();
    document.getElementById('term-prev-version').textContent = prevVersion;
    document.getElementById('term-next-version').textContent = nextVersion;
    document.getElementById('term-version').textContent = prevVersion;
    var btn = document.getElementById('term-provision-btn');
    btn.disabled = false;
    btn.textContent = 'RE-PROVISION AS WITHDRAW CARD (v' + nextVersion + ')';
    btn.classList.remove('opacity-50', 'bg-gray-600');
    btn.classList.add('bg-emerald-600', 'hover:bg-emerald-500');
    document.getElementById('term-provision-status').classList.add('hidden');
    document.getElementById('term-program-section').classList.add('hidden');
    document.getElementById('terminated-view').classList.remove('hidden');
  }

  function showWipedCard(result) {
    clearErrors();
    hideAllViews();
    currentTerminatedUid = result.uidHex;
    setCurrentProgrammingEndpoint(result.programmingEndpoint);
    var version = result.keyVersion || 1;
    document.getElementById('wiped-uid-display').textContent = 'UID: ' + result.uidHex.toUpperCase();
    document.getElementById('wiped-version').textContent = version;
    document.getElementById('wiped-key-version').textContent = version;
    document.getElementById('wiped-next-version').textContent = version + 1;
    var btn = document.getElementById('wiped-confirm-btn');
    btn.disabled = false;
    btn.textContent = 'YES, THIS CARD HAS BEEN WIPED';
    btn.classList.remove('opacity-50', 'bg-gray-600');
    btn.classList.add('bg-red-600', 'hover:bg-red-500');
    document.getElementById('wiped-confirm-status').classList.add('hidden');
    document.getElementById('wiped-detection-view').classList.remove('hidden');
  }

  function confirmWipedCard() {
    var uid = currentTerminatedUid;
    if (!uid) return;
    var btn = document.getElementById('wiped-confirm-btn');
    var status = document.getElementById('wiped-confirm-status');
    btn.disabled = true;
    btn.textContent = 'TERMINATING...';
    btn.classList.add('opacity-50');
    status.classList.remove('hidden');
    status.className = 'mt-3 text-center text-sm text-gray-400';
    status.textContent = 'Terminating card...';

    fetch(API_HOST + '/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uid: uid, action: 'terminate' }),
    }).then(function(resp) { return resp.json().then(function(data) { return { ok: resp.ok, data: data }; }); })
    .then(function(result) {
      if (result.ok && result.data.success) {
        status.className = 'mt-3 text-center text-sm text-emerald-400';
        status.textContent = 'Card terminated. Ready for re-provision at version ' + (result.data.keyVersion || 2) + '.';
        btn.textContent = 'TERMINATED';
        btn.classList.remove('bg-red-600', 'hover:bg-red-500');
        btn.classList.add('bg-gray-600');
        setTimeout(function() {
          showTerminatedCard({
            uidHex: uid,
            keyVersion: result.data.keyVersion || 2,
            cardState: 'terminated',
            programmingEndpoint: result.data.programmingEndpoint,
          });
        }, 1500);
      } else {
        throw new Error(result.data.error || 'Termination failed');
      }
    }).catch(function(e) {
      if (typeof window.reportClientError === 'function') window.reportClientError(e, 'login.js:terminate');
      status.className = 'mt-3 text-center text-sm text-red-400';
      status.textContent = 'Error: ' + e.message;
      btn.disabled = false;
      btn.textContent = 'YES, THIS CARD HAS BEEN WIPED';
      btn.classList.remove('opacity-50');
    });
  }

  function fetchWipeKeys() {
    var uid = document.getElementById('priv-uid-display').textContent.replace('UID: ', '').toLowerCase();
    if (!uid) return;
    var btn = document.getElementById('priv-fetch-wipe-btn');
    var status = document.getElementById('priv-wipe-status');
    btn.disabled = true;
    btn.textContent = 'FETCHING...';
    btn.classList.add('opacity-50');
    status.classList.remove('hidden');
    status.className = 'mt-3 text-center text-sm text-gray-400';
    status.textContent = 'Retrieving wipe keys...';

    fetch(API_HOST + '/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uid: uid, action: 'request-wipe' }),
    }).then(function(resp) { return resp.json().then(function(data) { return { ok: resp.ok, data: data }; }); })
    .then(function(result) {
      if (result.ok && result.data.success) {
        btn.textContent = 'WIPE KEYS RETRIEVED';
        btn.classList.remove('bg-red-600', 'hover:bg-red-500');
        btn.classList.add('bg-gray-600');
        status.className = 'mt-3 text-center text-sm text-emerald-400';
        status.textContent = 'Card is now pending wipe (v' + result.data.keyVersion + ')';
        renderQrCode('qr-priv-wipe', result.data.wipeJson);
        document.getElementById('priv-wipe-link').href = result.data.wipeDeeplink;
        document.getElementById('priv-wipe-json').textContent = result.data.wipeJson;
        document.getElementById('priv-wipe-result').classList.remove('hidden');
      } else {
        throw new Error(result.data.error || 'Failed to fetch wipe keys');
      }
    }).catch(function(e) {
      if (typeof window.reportClientError === 'function') window.reportClientError(e, 'login.js:fetch-wipe-keys');
      status.className = 'mt-3 text-center text-sm text-red-400';
      status.textContent = 'Error: ' + e.message;
      btn.disabled = false;
      btn.textContent = 'GET WIPE KEYS';
      btn.classList.remove('opacity-50');
    });
  }

  function topUpBalance() {
    var amountInput = document.getElementById('topup-amount');
    var statusEl = document.getElementById('topup-status');
    var amount = parseInt(amountInput.value, 10);
    if (!amount || amount <= 0) {
      statusEl.textContent = 'Enter a positive amount';
      statusEl.className = 'text-xs mt-2 text-red-400';
      statusEl.classList.remove('hidden');
      return;
    }
    statusEl.textContent = 'Processing...';
    statusEl.className = 'text-xs mt-2 text-gray-400';
    statusEl.classList.remove('hidden');

    fetch(API_HOST + '/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uid: currentUid, action: 'top-up', amount: amount }),
    }).then(function(resp) { return resp.json(); })
    .then(function(result) {
      if (result.success) {
        document.getElementById('priv-balance').textContent = result.balance;
        amountInput.value = '';
        statusEl.textContent = result.message;
        statusEl.className = 'text-xs mt-2 text-emerald-400';
      } else {
        statusEl.textContent = result.error || 'Top-up failed';
        statusEl.className = 'text-xs mt-2 text-red-400';
      }
    }).catch(function(e) {
      if (typeof window.reportClientError === 'function') window.reportClientError(e, 'login.js:topup');
      statusEl.textContent = 'Error: ' + e.message;
      statusEl.className = 'text-xs mt-2 text-red-400';
    });
  }

  function autoConfirmWipe(result) {
    clearErrors();
    hideAllViews();
    showNdef('No NDEF record found. UID: ' + result.uidHex.toUpperCase());
    fetch(API_HOST + '/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uid: result.uidHex, action: 'terminate' }),
    }).then(function(resp) { return resp.json(); })
    .then(function(data) {
      if (data.success) {
        showTerminatedCard({
          uidHex: result.uidHex,
          keyVersion: data.keyVersion || (result.keyVersion + 1),
          cardState: 'terminated',
          programmingEndpoint: data.programmingEndpoint,
        });
      } else {
        showPersistentError('Failed to confirm wipe: ' + (data.error || 'unknown'));
      }
    }).catch(function(e) {
      if (typeof window.reportClientError === 'function') window.reportClientError(e, 'login.js:confirm-wipe');
      showPersistentError('Wipe confirmation error: ' + e.message);
    });
  }

  function reprovisionCard() {
    if (!currentTerminatedUid) return;
    var btn = document.getElementById('term-provision-btn');
    var status = document.getElementById('term-provision-status');
    btn.disabled = true;
    btn.textContent = 'PROVISIONING...';
    btn.classList.add('opacity-50');
    status.classList.remove('hidden');
    status.className = 'mt-3 text-center text-sm text-gray-400';
    status.textContent = 'Generating new keys...';

    var endpoint = buildProgrammingEndpointUrl();
    fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ UID: currentTerminatedUid }),
    }).then(function(resp) { return resp.json().then(function(data) { return { ok: resp.ok, data: data }; }); })
    .then(function(result) {
      if (result.ok) {
        status.className = 'mt-3 text-center text-sm text-emerald-400';
        status.textContent = 'Card re-provisioned at version ' + (result.data.Version || 2) + '!';
        btn.textContent = 'PROVISIONED';
        btn.classList.remove('bg-emerald-600', 'hover:bg-emerald-500');
        btn.classList.add('bg-gray-600');
        var deeplink = buildProgrammingDeeplink(endpoint);
        renderQrCode('qr-term-program', deeplink);
        document.getElementById('term-program-deeplink').href = deeplink;
        document.getElementById('term-keys-delivered-time').textContent = 'Keys generated just now.';
        document.getElementById('term-program-section').classList.remove('hidden');
      } else {
        throw new Error(result.data.error || 'Provisioning failed');
      }
    }).catch(function(e) {
      if (typeof window.reportClientError === 'function') window.reportClientError(e, 'login.js:reprovision');
      status.className = 'mt-3 text-center text-sm text-red-400';
      status.textContent = 'Error: ' + e.message;
      btn.disabled = false;
      var prevVersion = document.getElementById('term-version').textContent;
      btn.textContent = 'RE-PROVISION AS WITHDRAW CARD (v' + (parseInt(prevVersion) + 1) + ')';
      btn.classList.remove('opacity-50');
    });
  }

  function reprovisionPrivateCard() {
    var uid = document.getElementById('priv-uid-display').textContent.replace('UID: ', '').toLowerCase();
    if (!uid) return;
    var btn = document.getElementById('priv-reprovision-btn');
    var status = document.getElementById('priv-reprovision-status');
    btn.disabled = true;
    btn.textContent = 'PROVISIONING...';
    btn.classList.add('opacity-50');
    status.classList.remove('hidden');
    status.className = 'mt-3 text-center text-sm text-gray-400';
    status.textContent = 'Generating new keys...';

    var endpoint = buildProgrammingEndpointUrl();
    fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ UID: uid }),
    }).then(function(resp) { return resp.json().then(function(data) { return { ok: resp.ok, data: data }; }); })
    .then(function(result) {
      if (result.ok) {
        status.className = 'mt-3 text-center text-sm text-emerald-400';
        status.textContent = 'Re-provisioned at version ' + (result.data.Version || 2) + '!';
        btn.textContent = 'PROVISIONED';
        btn.classList.remove('bg-emerald-600', 'hover:bg-emerald-500');
        btn.classList.add('bg-gray-600');
        var deeplink = buildProgrammingDeeplink(endpoint);
        renderQrCode('qr-priv-reprovision', deeplink);
        document.getElementById('priv-reprovision-deeplink').href = deeplink;
        document.getElementById('priv-reprovision-program').classList.remove('hidden');
      } else {
        throw new Error(result.data.error || 'Provisioning failed');
      }
    }).catch(function(e) {
      if (typeof window.reportClientError === 'function') window.reportClientError(e, 'login.js:reprovision-private');
      status.className = 'mt-3 text-center text-sm text-red-400';
      status.textContent = 'Error: ' + e.message;
      btn.disabled = false;
      btn.textContent = 'RE-PROVISION CARD';
      btn.classList.remove('opacity-50');
    });
  }

  function validateWithServer(p, c) {
    return fetch(API_HOST + '/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ p: p, c: c }),
    }).then(function(resp) { return resp.json(); });
  }

  function validateUid(uid) {
    return fetch(API_HOST + '/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uid: uid }),
    }).then(function(resp) { return resp.json(); });
  }

  function rescanCard() {
    hideAllViews();
    document.getElementById('login-view').classList.remove('hidden');
    document.getElementById('scan-status').textContent = 'Scanning... tap your card';
    scanner.scan();
  }
})();`;
export const LOGIN_JS_HASH = "8e74fa157133";

export const ACTIVATE_JS = `// activate.js — classic script (no import/export)
// Depends on: nfc.js (browserSupportsNfc, createNfcScanner)
// Used by both renderActivatePage() and renderActivateCardPage()

var UID_REGEX = /^[0-9a-f]{14}$/;

function validateUid(uid) {
  if (!uid || typeof uid !== 'string') return null;
  var normalized = uid.replace(/:/g, '').toLowerCase();
  if (!UID_REGEX.test(normalized)) return null;
  return normalized;
}

// --- Page 1: Activation page (QR codes, copy, toast) ---

(function initActivatePage() {
  var configEl = document.getElementById('activate-config');
  if (!configEl) return;

  var posBaseUrl = configEl.getAttribute('data-api-url') || '';
  var programUrl = configEl.getAttribute('data-program-url') || '';
  var resetUrl = configEl.getAttribute('data-reset-url') || '';
  var posQr = null;

  function updatePosConfig() {
    var address = document.getElementById('pos-lightning-address').value.trim();
    var amount = parseInt(document.getElementById('pos-amount').value) || 1;
    var amountMsat = amount * 1000;
    var posUrl = posBaseUrl + '&card_type=pos&lightning_address=' + encodeURIComponent(address) + '&min_sendable=' + amountMsat + '&max_sendable=' + amountMsat;
    var deepLink = 'boltcard://program?url=' + encodeURIComponent(posUrl);

    var linkEl = document.getElementById('link-pos');
    linkEl.textContent = deepLink;

    var deeplinkEl = document.getElementById('pos-deeplink');
    deeplinkEl.href = deepLink;

    if (posQr) posQr.clear();
    posQr.makeCode(posUrl);
  }

  function setup2faConfig() {
    var twoFaUrl = posBaseUrl + '&card_type=2fa';
    var deepLink = 'boltcard://program?url=' + encodeURIComponent(twoFaUrl);

    document.getElementById('link-2fa').textContent = deepLink;
    document.getElementById('2fa-deeplink').href = deepLink;

    var qr2fa = new QRCode(document.getElementById("qr-2fa"), {
      text: twoFaUrl,
      width: 200, height: 200,
      colorDark: "#000000", colorLight: "#ffffff",
      correctLevel: QRCode.CorrectLevel.L
    });
  }

  document.addEventListener('DOMContentLoaded', function() {
    new QRCode(document.getElementById("qr-program"), {
      text: programUrl,
      width: 200, height: 200,
      colorDark: "#000000", colorLight: "#ffffff",
      correctLevel: QRCode.CorrectLevel.L
    });

    new QRCode(document.getElementById("qr-reset"), {
      text: resetUrl,
      width: 200, height: 200,
      colorDark: "#000000", colorLight: "#ffffff",
      correctLevel: QRCode.CorrectLevel.L
    });

    posQr = new QRCode(document.getElementById("qr-pos"), {
      text: "",
      width: 200, height: 200,
      colorDark: "#000000", colorLight: "#ffffff",
      correctLevel: QRCode.CorrectLevel.L
    });

    updatePosConfig();
    setup2faConfig();

    document.getElementById('pos-lightning-address').addEventListener('input', updatePosConfig);
    document.getElementById('pos-amount').addEventListener('input', updatePosConfig);
  });

  // Copy + toast for activation page
  document.addEventListener('click', function(e) {
    var btn = e.target.closest('[data-copy-id]');
    if (!btn) return;
    var elementId = btn.getAttribute('data-copy-id');
    var el = document.getElementById(elementId);
    if (!el) return;
    var text = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' ? el.value : el.innerText;
    navigator.clipboard.writeText(text).then(function() {
      var toast = document.getElementById('toast');
      if (toast) {
        toast.classList.remove('translate-y-20', 'opacity-0');
        setTimeout(function() {
          toast.classList.add('translate-y-20', 'opacity-0');
        }, 2000);
      }
    }).catch(function() {});
  });
})();

// --- Page 2: Activate card form (NFC scan + submit) ---

(function initActivateCardPage() {
  var formEl = document.getElementById('activateForm');
  if (!formEl) return;

  var activateFormScanner = createNfcScanner({
    continuous: false,
    debounceMs: 0,
    onTap: function(data) {
      var nfcStatus = document.getElementById('nfc-status');
      var uidInput = document.getElementById('uid');
      nfcStatus.classList.remove('hidden');
      if (data.serial) {
        var formattedUid = data.serial;
        var validatedUid = validateUid(formattedUid);
        if (validatedUid) {
          uidInput.value = validatedUid;
          nfcStatus.className = 'rounded-lg px-4 py-3 text-sm mb-3 bg-emerald-500/10 border border-emerald-500/30 text-emerald-300';
          nfcStatus.textContent = 'Successfully scanned card UID: ' + validatedUid;
        } else {
          nfcStatus.className = 'rounded-lg px-4 py-3 text-sm mb-3 bg-red-500/10 border border-red-500/30 text-red-300';
          nfcStatus.textContent = 'Invalid UID format after processing. Expected 14 hex characters.';
        }
      } else {
        nfcStatus.className = 'rounded-lg px-4 py-3 text-sm mb-3 bg-red-500/10 border border-red-500/30 text-red-300';
        nfcStatus.textContent = 'Could not read UID from card. Please try again.';
      }
      var scanHint = document.getElementById('nfc-scanning-hint');
      if (scanHint) scanHint.textContent = 'Tap again to re-scan card';
    },
    onError: function(err, phase) {
      var nfcStatus = document.getElementById('nfc-status');
      if (phase !== 'permission') {
        nfcStatus.classList.remove('hidden');
        nfcStatus.className = 'rounded-lg px-4 py-3 text-sm mb-3 bg-red-500/10 border border-red-500/30 text-red-300';
        nfcStatus.textContent = 'Error: ' + err.message;
      }
    }
  });

  document.getElementById('activateForm').addEventListener('submit', function(e) {
    e.preventDefault();
    var result = document.getElementById('result');
    var uidInput = document.getElementById('uid');
    var validatedUid = validateUid(uidInput.value.replace(/:/g, '').toLowerCase());

    if (!validatedUid) {
      result.className = 'mt-4 text-sm text-red-300';
      result.textContent = 'Error: UID must be exactly 7 bytes (14 hex characters)';
      return;
    }

    fetch('/experimental/activate/form', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uid: validatedUid })
    }).then(function(r) { return r.json(); }).then(function(json) {
      if (json.status === 'OK') {
        result.className = 'mt-4 text-sm text-emerald-300';
        result.textContent = 'Card activated successfully! ' + (json.message || '');
      } else {
        result.className = 'mt-4 text-sm text-red-300';
        result.textContent = 'Error: ' + (json.reason || 'Unknown error');
      }
     }).catch(function(error) {
       if (typeof window.reportClientError === 'function') window.reportClientError(error, 'activate.js:submit');
       result.className = 'mt-4 text-sm text-red-300';
       result.textContent = 'Error submitting form: ' + error.message;
     });
  });
})();`;
export const ACTIVATE_JS_HASH = "5d4333367688";

export const ANALYTICS_JS = `// analytics.js — classic script (no import/export)
// No external dependencies

var UID_REGEX = /^[0-9a-f]{14}$/;

function _analyticsValidateUid(uid) {
  if (!uid || typeof uid !== 'string') return null;
  var normalized = uid.toLowerCase();
  if (!UID_REGEX.test(normalized)) return null;
  return normalized;
}

function _formatMsat(msat) {
  if (!msat || msat === 0) return '0 sats';
  var sats = msat / 1000;
  if (sats < 1) return msat + ' msat';
  if (sats < 1000) return (sats % 1 === 0 ? sats : sats.toFixed(3)) + ' sats';
  return (sats / 1e8).toFixed(8) + ' BTC';
}

function _loadAnalytics() {
  var uid = document.getElementById('uid-input').value.trim().toLowerCase();
  var normalizedUid = _analyticsValidateUid(uid);
  var errEl = document.getElementById('lookup-error');
  errEl.classList.add('hidden');

  if (!normalizedUid) {
    errEl.textContent = 'Invalid UID — must be 14 hex characters';
    errEl.classList.remove('hidden');
    return;
  }

  try {
    fetch('/analytics/data?uid=' + normalizedUid).then(function(resp) {
      if (!resp.ok) {
        errEl.textContent = 'Failed to load analytics (HTTP ' + resp.status + ')';
        errEl.classList.remove('hidden');
        return;
      }
      return resp.json().then(function(data) {
        _renderAnalytics(normalizedUid, data);
       });
     }).catch(function(e) {
       if (typeof window.reportClientError === 'function') window.reportClientError(e, 'analytics.js:load-data');
       errEl.textContent = 'Error: ' + e.message;
       errEl.classList.remove('hidden');
     });
   } catch (e) {
     if (typeof window.reportClientError === 'function') window.reportClientError(e, 'analytics.js:load-data');
     errEl.textContent = 'Error: ' + e.message;
     errEl.classList.remove('hidden');
   }
 }

function _renderAnalytics(uid, d) {
  document.getElementById('display-uid').textContent = uid.toUpperCase();
  document.getElementById('stat-completed').textContent = _formatMsat(d.completedMsat || 0);
  document.getElementById('stat-failed').textContent = _formatMsat(d.failedMsat || 0);
  document.getElementById('stat-pending').textContent = _formatMsat(d.pendingMsat || 0);
  document.getElementById('stat-taps').textContent = d.totalTaps || 0;

  document.getElementById('breakdown-completed-count').textContent = (d.completedTaps || 0) + ' taps';
  document.getElementById('breakdown-completed-amount').textContent = _formatMsat(d.completedMsat || 0);
  document.getElementById('breakdown-failed-count').textContent = (d.failedTaps || 0) + ' taps';
  document.getElementById('breakdown-failed-amount').textContent = _formatMsat(d.failedMsat || 0);
  document.getElementById('breakdown-pending-count').textContent = (d.pendingTaps || 0) + ' taps';
  document.getElementById('breakdown-pending-amount').textContent = _formatMsat(d.pendingMsat || 0);

  var total = d.totalTaps || 0;
  var completed = d.completedTaps || 0;
  var rate = total > 0 ? Math.round((completed / total) * 100) : 0;
  document.getElementById('success-bar').style.width = rate + '%';
  document.getElementById('success-rate').textContent = completed + ' / ' + total + ' (' + rate + '%)';

  document.getElementById('analytics-content').classList.remove('hidden');
}

document.addEventListener('click', function(e) {
  var btn = e.target.closest('[data-action="load-analytics"]');
  if (btn) _loadAnalytics();
});

var _analyticsParams = new URLSearchParams(window.location.search);
var _analyticsPrefill = _analyticsParams.get('uid');
if (_analyticsPrefill) {
  document.getElementById('uid-input').value = _analyticsPrefill;
  _loadAnalytics();
}`;
export const ANALYTICS_JS_HASH = "acb7eb5d907f";

export const CARD_AUDIT_JS = `// card-audit.js — classic script (no import/export)
// Depends on: nfc.js (stateLabel, stateColor, provenanceLabel, provenanceColor)

var currentFilter = "";
var nextCursor = null;
var hasMore = false;
var allCards = [];
var selectedUids = new Set();

function _auditFormatTime(ts) {
  if (!ts) return '-';
  try {
    var d = new Date(ts);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch (e) { return '-'; }
}

function _updateBatchBar() {
  var bar = document.getElementById('batch-bar');
  var count = selectedUids.size;
  document.getElementById('batch-count').textContent = count + ' selected';
  document.getElementById('btn-batch-terminate').disabled = count === 0;
  document.getElementById('btn-batch-wipe').disabled = count === 0;
  document.getElementById('btn-batch-activate').disabled = count === 0;
  document.getElementById('btn-batch-reprovision').disabled = count === 0;
  if (count > 0) {
    bar.classList.remove('hidden');
  } else {
    bar.classList.add('hidden');
  }
  document.getElementById('select-all-checkbox').checked = allCards.length > 0 && selectedUids.size === allCards.length;
}

function _toggleCard(uid) {
  if (selectedUids.has(uid)) {
    selectedUids.delete(uid);
  } else {
    selectedUids.add(uid);
  }
  _updateBatchBar();
}

function _loadCards(append) {
  if (!append) {
    nextCursor = null;
    hasMore = false;
    allCards = [];
    selectedUids.clear();
    _updateBatchBar();
    document.getElementById('loading').classList.remove('hidden');
    document.getElementById('cards-table').classList.add('hidden');
    document.getElementById('no-cards').classList.add('hidden');
    document.getElementById('error-display').classList.add('hidden');
    document.getElementById('batch-result').classList.add('hidden');
  }

  try {
    var url = '/operator/cards/data?limit=100';
    if (currentFilter) url += '&state=' + encodeURIComponent(currentFilter);
    if (append && nextCursor) url += '&cursor=' + encodeURIComponent(nextCursor);
    fetch(url).then(function(resp) {
      return resp.json().then(function(data) {
        document.getElementById('loading').classList.add('hidden');

        if (!resp.ok) {
          _showAuditError(data.reason || 'Failed to load cards');
          return;
        }

        var cards = data.cards || [];
        allCards = append ? allCards.concat(cards) : cards;
        hasMore = !!data.cursor;
        nextCursor = data.cursor || null;

        if (!append && cards.length === 0) {
          document.getElementById('no-cards').classList.remove('hidden');
          document.getElementById('load-more-container').classList.add('hidden');
          return;
        }

        document.getElementById('cards-table').classList.remove('hidden');
        _renderCards();

        if (hasMore) {
          document.getElementById('load-more-container').classList.remove('hidden');
        } else {
          document.getElementById('load-more-container').classList.add('hidden');
        }
      });
     }).catch(function(err) {
       if (typeof window.reportClientError === 'function') window.reportClientError(err, 'card-audit.js:load-cards');
       document.getElementById('loading').classList.add('hidden');
       _showAuditError('Failed to load card registry');
     });
   } catch (err) {
     if (typeof window.reportClientError === 'function') window.reportClientError(err, 'card-audit.js:load-cards');
     document.getElementById('loading').classList.add('hidden');
     _showAuditError('Failed to load card registry');
   }
 }

function _renderCards() {
  var list = document.getElementById('cards-list');
  list.replaceChildren.apply(list, allCards.map(function(card) {
    var row = document.createElement('div');
    row.className = 'grid grid-cols-7 gap-2 px-4 py-3 text-sm hover:bg-gray-700/30 transition-colors';

    var checkCell = document.createElement('div');
    checkCell.className = 'w-5';
    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'card-checkbox rounded';
    cb.setAttribute('data-uid', card.uid);
    cb.checked = selectedUids.has(card.uid);
    cb.addEventListener('change', function() {
      _toggleCard(this.getAttribute('data-uid'));
    });
    checkCell.appendChild(cb);
    row.appendChild(checkCell);

    var uidSpan = document.createElement('span');
    uidSpan.className = 'font-mono text-gray-300 text-xs';
    uidSpan.textContent = card.uid;
    row.appendChild(uidSpan);

    var stateSpan = document.createElement('span');
    stateSpan.className = 'font-mono ' + stateColor(card.state);
    stateSpan.textContent = card.state;
    row.appendChild(stateSpan);

    var provSpan = document.createElement('span');
    provSpan.className = 'font-mono text-xs ' + provenanceColor(card.keyProvenance);
    provSpan.textContent = provenanceLabel(card.keyProvenance, true);
    row.appendChild(provSpan);

    var labelSpan = document.createElement('span');
    labelSpan.className = 'font-mono text-xs text-gray-400';
    labelSpan.textContent = card.keyLabel || '-';
    row.appendChild(labelSpan);

    var timeSpan = document.createElement('span');
    timeSpan.className = 'text-xs text-gray-500';
    timeSpan.textContent = _auditFormatTime(card.updatedAt);
    row.appendChild(timeSpan);

    var linkCell = document.createElement('span');
    linkCell.className = 'text-right';
    var link = document.createElement('a');
    link.href = '/experimental/analytics?uid=' + encodeURIComponent(card.uid);
    link.className = 'text-emerald-500 hover:text-emerald-400 text-xs';
    link.textContent = 'View';
    linkCell.appendChild(link);
    row.appendChild(linkCell);

    return row;
  }));
}

function _batchAction(action) {
  if (selectedUids.size === 0) return;
  var uids = Array.from(selectedUids);
  var btnMap = { terminate: 'btn-batch-terminate', wipe: 'btn-batch-wipe', activate: 'btn-batch-activate', reprovision: 'btn-batch-reprovision' };
  var btn = document.getElementById(btnMap[action]);
  var origText = btn.textContent;
  btn.textContent = 'Working...';
  btn.disabled = true;

  fetch('/operator/cards/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uids: uids, action: action }),
  }).then(function(resp) {
    return resp.json().then(function(data) {
      var resultDiv = document.getElementById('batch-result');
      var contentDiv = document.getElementById('batch-result-content');

      if (!resp.ok) {
        _showAuditError(data.reason || 'Batch action failed');
        return;
      }

      var succeeded = data.results.filter(function(r) { return r.status !== 'skipped'; }).length;
      var skipped = data.results.filter(function(r) { return r.status === 'skipped'; }).length;
      var failed = (data.errors || []).length;

      var wrapper = document.createElement('div');
      wrapper.className = 'space-y-1';

      var successP = document.createElement('p');
      successP.className = 'text-emerald-300 font-semibold';
      successP.textContent = succeeded + ' card(s) processed: ' + action;
      wrapper.appendChild(successP);

      if (skipped > 0) {
        var skipP = document.createElement('p');
        skipP.className = 'text-yellow-300';
        skipP.textContent = skipped + ' card(s) skipped';
        wrapper.appendChild(skipP);
        data.results.filter(function(r) { return r.status === 'skipped'; }).forEach(function(r) {
          var detail = document.createElement('p');
          detail.className = 'text-xs text-gray-500 ml-3';
          detail.textContent = r.uid + ': ' + r.reason;
          wrapper.appendChild(detail);
        });
      }
      if (failed > 0) {
        var failP = document.createElement('p');
        failP.className = 'text-red-300';
        failP.textContent = failed + ' card(s) failed';
        wrapper.appendChild(failP);
        data.errors.forEach(function(e) {
          var detail = document.createElement('p');
          detail.className = 'text-xs text-gray-500 ml-3';
          detail.textContent = e.uid + ': ' + e.error;
          wrapper.appendChild(detail);
        });
      }
      contentDiv.replaceChildren(wrapper);
      resultDiv.classList.remove('hidden');

      selectedUids.clear();
      _updateBatchBar();
      _loadCards(false);
      btn.textContent = origText;
      btn.disabled = selectedUids.size === 0;
    });
   }).catch(function(err) {
     if (typeof window.reportClientError === 'function') window.reportClientError(err, 'card-audit.js:batch-action');
     _showAuditError('Batch action failed: ' + err.message);
     btn.textContent = origText;
     btn.disabled = selectedUids.size === 0;
   });
 }

function _showAuditError(msg) {
  document.getElementById('error-display').classList.remove('hidden');
  document.getElementById('error-message').textContent = msg;
}

document.addEventListener('click', function(e) {
  var btn = e.target.closest('[data-action]');
  if (!btn) return;
  var action = btn.getAttribute('data-action');
  switch (action) {
    case 'filter':
      currentFilter = btn.getAttribute('data-filter') || '';
      document.querySelectorAll('[data-action="filter"]').forEach(function(b) { b.classList.remove('ring-2', 'ring-emerald-500', 'bg-gray-600'); });
      btn.classList.add('ring-2', 'ring-emerald-500', 'bg-gray-600');
      _loadCards(false);
      break;
    case 'refresh':
      _loadCards(false);
      break;
    case 'load-more':
      _loadCards(true);
      break;
    case 'select-all':
      allCards.forEach(function(c) { selectedUids.add(c.uid); });
      _updateBatchBar();
      _renderCards();
      break;
    case 'deselect-all':
      selectedUids.clear();
      _updateBatchBar();
      _renderCards();
      break;
    case 'batch-terminate':
      _batchAction('terminate');
      break;
    case 'batch-wipe':
      _batchAction('wipe');
      break;
    case 'batch-activate':
      _batchAction('activate');
      break;
    case 'batch-reprovision':
      _batchAction('reprovision');
      break;
    case 'repair':
      _handleRepair(btn);
      break;
  }
});

document.getElementById('select-all-checkbox').addEventListener('change', function() {
  var checked = this.checked;
  allCards.forEach(function(c) {
    if (checked) selectedUids.add(c.uid);
    else selectedUids.delete(c.uid);
  });
  _updateBatchBar();
  _renderCards();
});

function _handleRepair(btn) {
  var origText = btn.textContent;
  btn.textContent = 'Scanning...';
  btn.disabled = true;
  document.getElementById('repair-result').classList.add('hidden');

  fetch('/operator/cards/repair', { method: 'POST' }).then(function(resp) {
    return resp.json().then(function(data) {
      var resultDiv = document.getElementById('repair-result');
      var contentDiv = document.getElementById('repair-result-content');

      if (!resp.ok) {
        var errP = document.createElement('p');
        errP.className = 'text-red-300';
        errP.textContent = 'Repair failed: ' + (data.error || 'unknown error');
        contentDiv.replaceChildren(errP);
      } else {
        var wrapper = document.createElement('div');
        var mainP = document.createElement('p');
        mainP.className = 'text-amber-300';
        mainP.textContent = 'Scanned ';
        var strong1 = document.createElement('strong');
        strong1.textContent = data.scanned;
        mainP.appendChild(strong1);
        mainP.appendChild(document.createTextNode(' card(s), repaired '));
        var strong2 = document.createElement('strong');
        strong2.textContent = data.repaired;
        mainP.appendChild(strong2);
        wrapper.appendChild(mainP);

        if (data.errors && data.errors.length > 0) {
          var errHeader = document.createElement('p');
          errHeader.className = 'text-red-300 text-xs mt-1';
          errHeader.textContent = data.errors.length + ' error(s):';
          wrapper.appendChild(errHeader);
          data.errors.forEach(function(e) {
            var detail = document.createElement('p');
            detail.className = 'text-xs text-gray-500 ml-3';
            detail.textContent = e.uid + ': ' + e.error;
            wrapper.appendChild(detail);
          });
        }
        if (data.repaired === 0 && (!data.errors || data.errors.length === 0)) {
          var noneP = document.createElement('p');
          noneP.className = 'text-gray-400 text-xs mt-1';
          noneP.textContent = 'All index entries match DO state.';
          wrapper.appendChild(noneP);
        }
        contentDiv.replaceChildren(wrapper);
      }
      resultDiv.classList.remove('hidden');
      if (data.repaired > 0) _loadCards(false);
      btn.textContent = origText;
      btn.disabled = false;
    });
   }).catch(function(err) {
     if (typeof window.reportClientError === 'function') window.reportClientError(err, 'card-audit.js:repair-action');
     _showAuditError('Index repair failed: ' + err.message);
     btn.textContent = origText;
     btn.disabled = false;
   });
 }

_loadCards(false);`;
export const CARD_AUDIT_JS_HASH = "7e6574c0d253";

export const MENU_EDITOR_JS = `// menu-editor.js — classic script (no import/export)

(function() {
  var configEl = document.getElementById('menu-editor-config');
  var items = configEl ? JSON.parse(configEl.getAttribute('data-items') || '[]') : [];
  var terminalId = configEl ? configEl.getAttribute('data-terminal-id') : '';

  function render() {
    var list = document.getElementById('items-list');
    if (items.length === 0) {
      var p = document.createElement('p');
      p.className = 'text-gray-500 text-sm text-center py-4';
      p.textContent = 'No items. Click "Add Item" to start.';
      list.replaceChildren(p);
      return;
    }
    list.replaceChildren.apply(list, items.map(function(item, i) {
      var row = document.createElement('div');
      row.className = 'flex items-center gap-2 bg-gray-800 border border-gray-700 rounded-lg p-3';

      var nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.dataset.idx = i;
      nameInput.dataset.field = 'name';
      nameInput.value = item.name;
      nameInput.placeholder = 'Item name';
      nameInput.className = 'flex-1 bg-gray-900 border border-gray-600 rounded px-2 py-1.5 text-gray-200 text-sm focus:border-emerald-500 focus:outline-none';
      nameInput.addEventListener('input', function() {
        items[i].name = this.value;
      });
      row.appendChild(nameInput);

      var priceInput = document.createElement('input');
      priceInput.type = 'number';
      priceInput.dataset.idx = i;
      priceInput.dataset.field = 'price';
      priceInput.value = String(item.price);
      priceInput.placeholder = 'Price';
      priceInput.min = '0';
      priceInput.className = 'w-24 bg-gray-900 border border-gray-600 rounded px-2 py-1.5 text-gray-200 text-sm text-right focus:border-emerald-500 focus:outline-none';
      priceInput.addEventListener('input', function() {
        items[i].price = parseInt(this.value) || 0;
      });
      row.appendChild(priceInput);

      var removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.textContent = '\\u00D7';
      removeBtn.className = 'text-red-500 hover:text-red-400 text-lg font-bold px-1';
      removeBtn.addEventListener('click', function() { items.splice(i, 1); render(); });
      row.appendChild(removeBtn);

      return row;
    }));
  }

  document.getElementById('add-item-btn').addEventListener('click', function() {
    items.push({ name: '', price: 0 });
    render();
    var inputs = document.querySelectorAll('[data-field="name"]');
    if (inputs.length) inputs[inputs.length - 1].focus();
  });

  document.getElementById('clear-btn').addEventListener('click', function() {
    if (items.length === 0) return;
    items = [];
    render();
  });

  document.getElementById('save-btn').addEventListener('click', function() {
    var valid = items.filter(function(i) { return i.name.trim(); });
    var status = document.getElementById('status');
    status.classList.remove('hidden');
    status.className = 'mt-4 text-center text-sm text-gray-400';
    status.textContent = 'Saving...';
    fetch('/operator/pos/menu?t=' + terminalId, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: valid }),
    }).then(function(resp) {
      return resp.json().then(function(data) {
        if (resp.ok && data.success) {
          status.className = 'mt-4 text-center text-sm text-emerald-400';
          status.textContent = 'Saved ' + valid.length + ' items';
        } else {
          status.className = 'mt-4 text-center text-sm text-red-400';
          status.textContent = data.error || 'Save failed';
        }
      });
    }).catch(function(e) {
      if (typeof window.reportClientError === 'function') window.reportClientError(e, 'menu-editor.js:save');
      status.className = 'mt-4 text-center text-sm text-red-400';
      status.textContent = 'Network error: ' + e.message;
    });
  });

  render();
})();`;
export const MENU_EDITOR_JS_HASH = "789d4ae511f1";

export const WIPE_JS = `// wipe.js — classic script (no import/export)
// Depends on: nfc.js (browserSupportsNfc, createNfcScanner)

(function() {
  var wipeRoot = document.getElementById('wipe-root');
  var baseUrl = wipeRoot ? wipeRoot.getAttribute('data-base-url') : '';
  var resetApiUrl = wipeRoot ? wipeRoot.getAttribute('data-reset-api-url') : '';
  var wipeQrCode = null;
  var currentResetLink = '';

  // Workflow 1: NFC Scanner (auto-starts on load)
  var wipeScanner = createNfcScanner({
    continuous: false,
    debounceMs: 0,
    onStatus: function(status) {
      var autoHint = document.getElementById('scan-auto-hint');
      var btn = document.getElementById('btn-scan');
      if (status === 'scanning') {
        if (autoHint) autoHint.classList.remove('hidden');
        btn.classList.add('hidden');
      } else {
        if (autoHint) autoHint.classList.add('hidden');
      }
    },
    onError: function(err, phase) {
      var autoHint = document.getElementById('scan-auto-hint');
      if (autoHint) autoHint.classList.add('hidden');
      if (phase !== 'permission') {
        alert("Error reading NFC: " + err.message);
      }
    },
    onTap: function(data) {
      var autoHint = document.getElementById('scan-auto-hint');
      if (autoHint) autoHint.classList.add('hidden');
      var btn = document.getElementById('btn-scan');
      document.getElementById('scan-uid').innerText = data.serial || "Unknown";
      var pParam = "Not found";
      var cParam = "Not found";
      if (data.url) {
        try {
          var url = new URL(data.url);
          pParam = url.searchParams.get("p") || pParam;
          cParam = url.searchParams.get("c") || cParam;
        } catch(e) {}
      }
      document.getElementById('scan-p').innerText = pParam;
      document.getElementById('scan-c').innerText = cParam;
      document.getElementById('scan-results').classList.remove('hidden');
      btn.classList.remove('hidden');
      btn.innerText = "SCAN AGAIN";
    }
  });

  if (browserSupportsNfc()) {
    canAutoStartNfc().then(function(granted) {
      if (granted) {
        window.addEventListener('load', function() { wipeScanner.scan(); });
      } else {
        var btn = document.getElementById('btn-scan');
        if (btn) btn.classList.remove('hidden');
        var autoHint = document.getElementById('scan-auto-hint');
        if (autoHint) autoHint.classList.add('hidden');
      }
    });
  }

  document.getElementById('btn-scan').addEventListener('click', function() {
    wipeScanner.restart();
  });

  // Handlers for Wipe requests
  document.getElementById('btn-wipe-scanned').addEventListener('click', function() {
    var uid = document.getElementById('scan-uid').innerText;
    if (!uid || uid === "Unknown") {
      alert("Valid UID required.");
      return;
    }
    fetchWipeKeys(uid);
  });

  document.getElementById('btn-wipe-manual').addEventListener('click', function() {
    var uid = document.getElementById('manual-uid').value.trim().toLowerCase();
    if (!uid || uid.length !== 14) {
      alert("Please enter a valid 14-character hex UID.");
      return;
    }
    fetchWipeKeys(uid);
  });

  function fetchWipeKeys(uid) {
    var wipeApiUrl = baseUrl + '/wipe?uid=' + encodeURIComponent(uid);
    fetch(wipeApiUrl)
      .then(function(r) { return r.json(); })
      .then(function(data) {
        displayOutput(uid, data, resetApiUrl);
      })
       .catch(function(error) {
         if (typeof window.reportClientError === 'function') window.reportClientError(error, 'wipe.js:fetch-keys');
         alert("Error fetching wipe keys: " + error.message);
       });
  }

  function displayOutput(uid, data, resetApiUrl) {
    document.getElementById('output-section').classList.remove('hidden');
    document.getElementById('output-uid-badge').innerText = 'UID: ' + uid.toUpperCase();
    document.getElementById('api-response').innerText = JSON.stringify(data, null, 2);

    currentResetLink = 'boltcard://reset?url=' + encodeURIComponent(resetApiUrl);
    document.getElementById('link-wipe-btn').href = currentResetLink;
    document.getElementById('link-wipe-text').innerText = currentResetLink;

    var qrContainer = document.getElementById('qr-wipe');
    qrContainer.replaceChildren();

    wipeQrCode = new QRCode(qrContainer, {
      text: currentResetLink,
      width: 180,
      height: 180,
      colorDark : "#000000",
      colorLight : "#ffffff",
      correctLevel : QRCode.CorrectLevel.L
    });

    document.getElementById('output-section').scrollIntoView({ behavior: 'smooth' });
  }

  // Event delegation for data-action buttons
  document.addEventListener('click', function(e) {
    var btn = e.target.closest('[data-action]');
    if (!btn) return;
    var action = btn.getAttribute('data-action');
    if (action === 'copy-wipe-link') {
      navigator.clipboard.writeText(currentResetLink).then(function() {
        var toast = document.getElementById('toast');
        toast.classList.remove('translate-y-20', 'opacity-0');
        setTimeout(function() {
          toast.classList.add('translate-y-20', 'opacity-0');
        }, 2000);
      });
    }
  });
})();`;
export const WIPE_JS_HASH = "02c9ea87e856";

export const BULK_WIPE_JS = `// bulk-wipe.js — classic script (no import/export)
// Depends on: nfc.js (browserSupportsNfc, createNfcScanner)

var UID_REGEX = /^[0-9a-f]{14}$/;
function validateUid(uid) {
  var normalized = uid.replace(/:/g, '').toLowerCase();
  if (UID_REGEX.test(normalized)) return normalized;
  return null;
}

(function() {
  var bulkRoot = document.getElementById('bulk-wipe-root');
  var baseUrl = bulkRoot ? bulkRoot.getAttribute('data-base-url') : '';

  function _el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  // Tap-to-detect
  var detectScanner = null;
  var detectedUid = null;
  var detectedVersion = null;
  var detectedFingerprint = null;

  function initDetectScanner() {
    detectScanner = createNfcScanner({
      continuous: false,
      debounceMs: 0,
      onTap: function(data) {
        var url = data.url;
        if (!url) {
          document.getElementById('detect-error').textContent = 'No URL found on card. The card may not be programmed.';
          document.getElementById('detect-error').classList.remove('hidden');
          document.getElementById('detect-status').classList.add('hidden');
          return;
        }
        try {
          var parsed = new URL(url);
          var p = parsed.searchParams.get('p');
          var c = parsed.searchParams.get('c');
          if (!p || !c) {
            document.getElementById('detect-error').textContent = 'Card URL missing p/c parameters.';
            document.getElementById('detect-error').classList.remove('hidden');
            document.getElementById('detect-status').classList.add('hidden');
            return;
          }
          document.getElementById('detect-status').querySelector('span').textContent = 'Identifying card...';
          fetch('/api/identify-issuer-key', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ p: p, c: c })
          }).then(function(r) { return r.json(); }).then(function(result) {
            document.getElementById('detect-status').classList.add('hidden');
            if (result.matched) {
              detectedUid = result.uid;
              detectedVersion = result.version;
              detectedFingerprint = result.issuerKeyFingerprint;
              document.getElementById('detect-uid').textContent = result.uid.toUpperCase();
              document.getElementById('detect-version').textContent = result.version;
              document.getElementById('detect-label').textContent = result.issuerKeyLabel;
              document.getElementById('detect-result').classList.remove('hidden');
              document.getElementById('detect-error').classList.add('hidden');
              var keySelect = document.getElementById('key-select');
              var matchedOption = keySelect.querySelector('option[data-fingerprint="' + result.issuerKeyFingerprint + '"]');
              if (matchedOption) {
                keySelect.value = matchedOption.value;
                keySelect.dispatchEvent(new Event('change'));
              } else {
                keySelect.value = 'custom';
                keySelect.dispatchEvent(new Event('change'));
                document.getElementById('custom-key').value = '';
                document.getElementById('custom-key').focus();
              }
            } else {
              document.getElementById('detect-error').textContent = 'Unknown issuer \\u2014 this card was not provisioned with any of our known issuer keys. Switch to Custom key\\u2026 and paste the master secret manually.';
              document.getElementById('detect-error').classList.remove('hidden');
              document.getElementById('detect-result').classList.add('hidden');
              document.getElementById('key-select').value = 'custom';
              document.getElementById('key-select').dispatchEvent(new Event('change'));
              document.getElementById('custom-key').focus();
            }
          }).catch(function(e) {
            if (typeof window.reportClientError === 'function') window.reportClientError(e, 'bulk-wipe.js:identify');
            document.getElementById('detect-error').textContent = 'Error: ' + e.message;
            document.getElementById('detect-error').classList.remove('hidden');
            document.getElementById('detect-status').classList.add('hidden');
          });
        } catch (e) {
          if (typeof window.reportClientError === 'function') window.reportClientError(e, 'bulk-wipe.js:identify');
          document.getElementById('detect-error').textContent = 'Error: ' + e.message;
          document.getElementById('detect-error').classList.remove('hidden');
          document.getElementById('detect-status').classList.add('hidden');
        }
      },
      onError: function(err, phase) {
        if (phase === 'permission') {
          document.getElementById('detect-status').querySelector('span').textContent = 'NFC permission denied. Tap to retry.';
        }
      },
      onStatus: function(status) {
        var el = document.getElementById('detect-status');
        if (status === 'scanning') {
          el.classList.remove('hidden');
          el.querySelector('span').textContent = 'Tap your card to detect issuer key...';
        } else {
          el.classList.add('hidden');
        }
      }
    });
  }

  if (browserSupportsNfc()) {
    initDetectScanner();
    canAutoStartNfc().then(function(granted) {
      if (granted) {
        window.addEventListener('load', function() { detectScanner.scan(); });
      } else {
        var statusEl = document.getElementById('detect-status');
        statusEl.classList.remove('hidden');
        statusEl.querySelector('span').textContent = 'Tap here to start NFC scanning';
        statusEl.style.cursor = 'pointer';
        statusEl.addEventListener('click', function() { detectScanner.scan(); });
      }
    });
  } else {
    document.getElementById('detect-status').querySelector('span').textContent = 'Web NFC not supported. Use Chrome on Android.';
    document.getElementById('detect-status').querySelector('div').className = 'w-2 h-2 bg-red-500 rounded-full';
  }

  document.getElementById('detect-wipe-this').addEventListener('click', function() {
    if (!detectedUid) return;
    document.getElementById('uid-input').value = detectedUid.toUpperCase();
    var keySelect = document.getElementById('key-select');
    if (keySelect.value !== 'custom') {
      var matchedOption = keySelect.querySelector('option[data-fingerprint="' + detectedFingerprint + '"]');
      if (matchedOption) keySelect.value = matchedOption.value;
    }
    document.getElementById('btn-generate').click();
  });

  document.getElementById('detect-use-key').addEventListener('click', function() {
    document.getElementById('uid-input').scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  // Toggle custom key section
  document.getElementById('key-select').addEventListener('change', function(e) {
    var section = document.getElementById('custom-key-section');
    if (e.target.value === 'custom') {
      section.classList.remove('hidden');
    } else {
      section.classList.add('hidden');
    }
  });

  // Show inline error
  function showError(msg) {
    var el = document.getElementById('error-msg');
    el.textContent = msg;
    el.classList.remove('hidden');
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function hideError() {
    document.getElementById('error-msg').classList.add('hidden');
  }

  // Toast
  function showToast() {
    var toast = document.getElementById('toast');
    toast.classList.remove('translate-y-20', 'opacity-0');
    setTimeout(function() {
      toast.classList.add('translate-y-20', 'opacity-0');
    }, 2000);
  }

  // Copy helper
  function copyText(text) {
    navigator.clipboard.writeText(text).then(function() { showToast(); }).catch(function() {});
  }

  // Generate button
  document.getElementById('btn-generate').addEventListener('click', function() {
    hideError();
    var results = document.getElementById('results');
    results.replaceChildren();

    var keySelect = document.getElementById('key-select');
    var key = keySelect.value;
    if (key === 'custom') {
      key = document.getElementById('custom-key').value.trim().toLowerCase();
      if (!key || !/^[0-9a-f]{32}$/.test(key)) {
        showError('Please enter a valid 32-character hex issuer key.');
        return;
      }
    }
    if (!key) {
      showError('Please select an issuer key.');
      return;
    }

    var raw = document.getElementById('uid-input').value;
    var uids = raw.split(/[\\n\\r]+/).map(function(u) { return u.trim().toLowerCase(); }).filter(function(u) { return u.length > 0; });
    if (uids.length === 0) {
      showError('Please enter at least one card UID.');
      return;
    }

    var invalidUids = uids.filter(function(u) { return !validateUid(u); });
    if (invalidUids.length > 0) {
      showError('Invalid UID format (must be 14 hex chars): ' + invalidUids.join(', '));
      return;
    }

    var btn = document.getElementById('btn-generate');
    btn.disabled = true;
    btn.textContent = 'PROCESSING ' + uids.length + ' CARD(S)...';

    (function processUids(index) {
      if (index >= uids.length) {
        btn.disabled = false;
        btn.textContent = 'GENERATE WIPE DATA';
        if (results.children.length > 0) {
          results.children[0].scrollIntoView({ behavior: 'smooth' });
        }
        return;
      }
      var uid = uids[index];
      var apiUrl = baseUrl + '/api/bulk-wipe-keys?uid=' + encodeURIComponent(uid) + '&key=' + encodeURIComponent(key);
      fetch(apiUrl).then(function(resp) {
        if (!resp.ok) return resp.text().then(function(errBody) {
          renderCardError(results, uid, 'Server error ' + resp.status + ': ' + errBody);
          processUids(index + 1);
        });
        return resp.json().then(function(data) {
          renderCardResult(results, data);
          processUids(index + 1);
        });
      }).catch(function(err) {
        if (typeof window.reportClientError === 'function') window.reportClientError(err, 'bulk-wipe.js:batch-action');
        renderCardError(results, uid, 'Fetch failed: ' + err.message);
        processUids(index + 1);
      });
    })(0);
  });

  function renderCardResult(container, data) {
    var uid = (data.uid || '').toUpperCase();
    var wipeJson = data.wipe_json || {};
    var wipeJsonStr = JSON.stringify(wipeJson);
    var resetLink = data.reset_deeplink || '';

    var card = document.createElement('div');
    card.className = 'bg-gray-800 border border-gray-700 rounded-lg p-6 shadow-xl';

    var header = _el('div', 'flex items-center justify-between mb-4 border-b border-gray-700 pb-2');
    var h3 = _el('h3', 'text-lg font-bold text-gray-200');
    h3.appendChild(document.createTextNode('UID: '));
    var uidSpan = _el('span', 'text-amber-500 font-mono');
    uidSpan.textContent = uid;
    h3.appendChild(uidSpan);
    header.appendChild(h3);
    header.appendChild(_el('span', 'px-2 py-1 bg-green-500/10 text-green-500 text-xs font-mono rounded border border-green-500/20', 'OK'));
    card.appendChild(header);

    var grid = _el('div', 'grid grid-cols-1 md:grid-cols-2 gap-6');
    var jsonCol = _el('div');
    jsonCol.appendChild(_el('label', 'block text-xs font-bold text-gray-500 uppercase mb-2', 'Wipe JSON'));
    var pre = _el('pre', 'font-mono text-xs text-green-400 bg-gray-900 p-4 rounded border border-gray-700 overflow-x-auto min-h-[140px] mb-2');
    pre.textContent = JSON.stringify(wipeJson, null, 2);
    jsonCol.appendChild(pre);
    var jsonCopyBtn = _el('button', 'copy-btn text-xs text-amber-500 hover:text-amber-400 font-bold', 'COPY JSON');
    jsonCopyBtn.dataset.copy = encodeURIComponent(wipeJsonStr);
    jsonCol.appendChild(jsonCopyBtn);
    grid.appendChild(jsonCol);

    var qrCol = _el('div', 'flex flex-col items-center');
    qrCol.appendChild(_el('label', 'block text-xs font-bold text-gray-500 uppercase mb-2', 'QR Code'));
    var qrDiv = _el('div', 'qr-container mb-4');
    qrDiv.id = 'qr-' + data.uid;
    qrCol.appendChild(qrDiv);
    grid.appendChild(qrCol);
    card.appendChild(grid);

    var footer = _el('div', 'mt-4 bg-gray-900 rounded p-3 border border-gray-800');
    var footerRow = _el('div', 'flex justify-between items-center mb-2');
    footerRow.appendChild(_el('span', 'text-xs font-bold text-red-500 uppercase', 'Reset Deeplink'));
    var linkCopyBtn = _el('button', 'copy-btn text-xs text-amber-500 hover:text-amber-400 font-bold', 'COPY LINK');
    linkCopyBtn.dataset.copy = encodeURIComponent(resetLink);
    footerRow.appendChild(linkCopyBtn);
    footer.appendChild(footerRow);
    var resetAnchor = document.createElement('a');
    resetAnchor.href = resetLink;
    resetAnchor.className = 'text-blue-400 hover:text-blue-300 text-sm font-mono break-all underline';
    resetAnchor.textContent = resetLink;
    footer.appendChild(resetAnchor);
    card.appendChild(footer);

    container.appendChild(card);

    if (qrDiv && wipeJsonStr) {
      new QRCode(qrDiv, {
        text: wipeJsonStr,
        width: 200,
        height: 200,
        colorDark: "#000000",
        colorLight: "#ffffff",
        correctLevel: QRCode.CorrectLevel.L
      });
    }
  }

  function renderCardError(container, uid, msg) {
    var card = document.createElement('div');
    card.className = 'bg-gray-800 border border-red-500/30 rounded-lg p-6 shadow-xl';

    var header = _el('div', 'flex items-center justify-between mb-2');
    var h3 = _el('h3', 'text-lg font-bold text-gray-200');
    h3.appendChild(document.createTextNode('UID: '));
    var uidSpan = _el('span', 'text-amber-500 font-mono');
    uidSpan.textContent = uid.toUpperCase();
    h3.appendChild(uidSpan);
    header.appendChild(h3);
    header.appendChild(_el('span', 'px-2 py-1 bg-red-500/10 text-red-500 text-xs font-mono rounded border border-red-500/20', 'ERROR'));
    card.appendChild(header);

    card.appendChild(_el('p', 'text-sm text-red-400 font-mono', msg));

    container.appendChild(card);
  }

  // Event delegation for copy buttons
  document.getElementById('results').addEventListener('click', function(e) {
    var btn = e.target.closest('.copy-btn');
    if (btn) {
      copyText(decodeURIComponent(btn.getAttribute('data-copy')));
    }
  });
})();`;
export const BULK_WIPE_JS_HASH = "f559b75ad84f";

export const TWO_FACTOR_JS = `// two-factor.js — classic script (no import/export)
// Contains both OTP timer (renderTwoFactorPage) and NFC landing scanner (renderTwoFactorLandingPage)
// Depends on: nfc.js (browserSupportsNfc, extractNdefUrl, normalizeBrowserNfcUrl)

window._nfcPageHandler = true;

// === Part 1: OTP countdown timer (used by renderTwoFactorPage) ===
(function initOtpTimer() {
  var otpRoot = document.getElementById('otp-root');
  if (!otpRoot) return; // not on OTP page

  var bar = document.getElementById('totp-bar');
  var timer = document.getElementById('totp-timer');
  var seconds = parseInt(otpRoot.getAttribute('data-seconds-remaining'), 10);
  if (isNaN(seconds)) seconds = 30;

  setInterval(function() {
    seconds--;
    if (seconds < 0) seconds = 29;
    if (bar) bar.style.width = ((seconds / 30) * 100) + '%';
    if (timer) timer.textContent = seconds + 's';
  }, 1000);
  setTimeout(function() { window.location.reload(); }, 30000);
})();

// === Part 2: NFC landing scanner (used by renderTwoFactorLandingPage) ===
(function initTwoFactorLanding() {
  var landingRoot = document.getElementById('twofa-landing-root');
  if (!landingRoot) return; // not on landing page

  var BASE_URL = landingRoot.getAttribute('data-base-url') || '';
  var scanStatus = document.getElementById('scan-status');
  var scanDetail = document.getElementById('scan-detail');
  var scanError = document.getElementById('scan-error');
  var scanButton = document.getElementById('scan-button');
  var scanIndicator = document.getElementById('scan-indicator');
  var scanAbortController = null;

  function updateIndicator(active) {
    if (active) {
      scanIndicator.className = 'rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-200 transition hover:bg-emerald-500/20';
      scanIndicator.textContent = 'NFC active \\u00b7 click to restart';
    } else {
      scanIndicator.className = 'rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm font-semibold text-red-200 transition hover:bg-red-500/20';
      scanIndicator.textContent = 'NFC inactive \\u00b7 click to start';
    }
  }

  function showError(message) {
    scanError.textContent = message;
    scanError.classList.remove('hidden');
  }

  function clearError() {
    scanError.textContent = '';
    scanError.classList.add('hidden');
  }

  function startScan() {
    clearError();
    if (!browserSupportsNfc()) {
      scanStatus.textContent = 'Web NFC unavailable';
      scanDetail.textContent = 'Use Chrome on Android to demo boltcard-powered 2FA.';
      showError('Web NFC is not supported on this device/browser.');
      return;
    }

    if (scanAbortController) {
      scanAbortController.abort();
    }

    try {
      var ndef = new NDEFReader();
      scanAbortController = new AbortController();
      ndef.scan({ signal: scanAbortController.signal }).then(function() {
        updateIndicator(true);
        scanStatus.textContent = 'Scanning for boltcard payload\\u2026';
        scanDetail.textContent = 'Tap the card now. We will redirect into the live TOTP/HOTP view.';

        ndef.onreadingerror = function() {
          showError('NFC read failed. Try holding the card still against the back of the device.');
        };

        ndef.onreading = function(event) {
          extractNdefUrl(event.message.records, ['lnurlw://', 'https://']).then(function(rawUrl) {
            var url = normalizeBrowserNfcUrl(rawUrl);
            if (!url) {
              showError('No compatible boltcard URL was found on the card.');
              return;
            }

            var parsed = new URL(url);
            var p = parsed.searchParams.get('p');
            var c = parsed.searchParams.get('c');
            if (!p || !c) {
              showError('The scanned card did not include the signed 2FA parameters.');
              return;
            }

            scanStatus.textContent = 'Card read. Opening OTP screen\\u2026';
            window.location.href = BASE_URL + '/2fa?p=' + encodeURIComponent(p) + '&c=' + encodeURIComponent(c);
          });
        };
       }).catch(function(error) {
         updateIndicator(false);
         if (error.name !== 'AbortError') {
           if (typeof window.reportClientError === 'function') window.reportClientError(error, 'two-factor.js:scan');
           showError(error.message || 'Unable to start NFC scan.');
           scanStatus.textContent = 'Unable to start NFC scan';
         }
       });
     } catch (error) {
       if (typeof window.reportClientError === 'function') window.reportClientError(error, 'two-factor.js:scan');
       updateIndicator(false);
       showError(error.message || 'Unable to start NFC scan.');
       scanStatus.textContent = 'Unable to start NFC scan';
     }
  }

  scanButton.addEventListener('click', startScan);
  scanIndicator.addEventListener('click', startScan);
  updateIndicator(false);
  if (browserSupportsNfc()) {
    canAutoStartNfc().then(function(granted) {
      if (granted) {
        window.addEventListener('load', startScan);
      }
      // If not granted, scanButton/scanIndicator click handlers provide the user gesture
    });
  }
})();`;
export const TWO_FACTOR_JS_HASH = "14028afcd158";

export const BOLT11_DECODE_JS = `// bolt11-decode.js — classic script (no import/export)

(function() {
  function decode() {
    var input = document.getElementById('invoice-input').value.trim();
    var errEl = document.getElementById('decode-error');
    var resultEl = document.getElementById('decode-result');
    errEl.classList.add('hidden');
    resultEl.classList.add('hidden');

    if (!input) {
      errEl.textContent = 'Please paste a BOLT11 invoice';
      errEl.classList.remove('hidden');
      return;
    }

    fetch('/api/decode?invoice=' + encodeURIComponent(input))
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (!data.ok) {
          errEl.textContent = data.error || 'Decode failed';
          errEl.classList.remove('hidden');
          return;
        }
        renderResult(data);
      })
       .catch(function(e) {
         if (typeof window.reportClientError === 'function') window.reportClientError(e, 'bolt11-decode.js:decode');
         errEl.textContent = 'Request failed: ' + e.message;
         errEl.classList.remove('hidden');
       });
   }

  function makeBadge(text, bgClass, textClass) {
    var span = document.createElement('span');
    span.className = 'inline-block px-2 py-0.5 text-xs font-bold rounded ' + bgClass + ' ' + textClass;
    span.textContent = text;
    return span;
  }

  function cardEl(labelEl, valueContent) {
    var div = document.createElement('div');
    div.className = 'bg-gray-800 border border-gray-700 rounded-lg p-3';
    var labelP = document.createElement('p');
    labelP.className = 'text-xs text-gray-500 uppercase tracking-wider mb-1';
    labelP.appendChild(labelEl);
    div.appendChild(labelP);
    var valueP = document.createElement('p');
    valueP.className = 'text-sm font-mono text-gray-200';
    valueP.appendChild(valueContent);
    div.appendChild(valueP);
    return div;
  }

  function textNode(s) {
    return document.createTextNode(String(s));
  }

  function renderResult(d) {
    document.getElementById('decode-result').classList.remove('hidden');

    var sigBadge = d.signatureValid
      ? makeBadge('VALID', 'bg-emerald-900', 'text-emerald-300')
      : makeBadge('INVALID', 'bg-red-900', 'text-red-300');

    var expiryBadge = d.isExpired
      ? makeBadge('EXPIRED', 'bg-red-900', 'text-red-300')
      : makeBadge('ACTIVE', 'bg-emerald-900', 'text-emerald-300');

    var headerCards = [
      cardEl(textNode('Network'), textNode(d.network)),
      cardEl(textNode('Amount'), textNode(d.amountDisplay || 'any')),
      cardEl(textNode('Timestamp'), textNode(d.timestampISO || '')),
      (function() {
        var c = cardEl(textNode('Expiry'), textNode(d.expiry + 's '));
        c.querySelector('p:last-child').appendChild(expiryBadge);
        return c;
      })(),
      cardEl(textNode('Expires At'), textNode(d.expiresAt || '')),
      cardEl(textNode('Signature'), sigBadge),
    ];
    document.getElementById('result-header').replaceChildren.apply(
      document.getElementById('result-header'), headerCards
    );

    var table = document.createElement('table');
    table.className = 'w-full';
    var tags = d.rawTags || [];
    for (var i = 0; i < tags.length; i++) {
      var t = tags[i];
      var tr = document.createElement('tr');
      tr.className = 'border-b border-gray-700/50';

      var td1 = document.createElement('td');
      td1.className = 'px-4 py-2 text-xs text-gray-500 font-mono whitespace-nowrap';
      td1.textContent = t.name + ' ';
      var codeSpan = document.createElement('span');
      codeSpan.className = 'text-gray-600';
      codeSpan.textContent = '[' + t.code + ']';
      td1.appendChild(codeSpan);
      tr.appendChild(td1);

      var td2 = document.createElement('td');
      td2.className = 'px-4 py-2 text-sm text-gray-300';
      if (Array.isArray(t.value)) {
        t.value.forEach(function(v) {
          var chip = document.createElement('span');
          chip.className = 'inline-block bg-gray-700 rounded px-1.5 py-0.5 text-xs mr-1 mb-1';
          chip.textContent = v;
          td2.appendChild(chip);
        });
      } else {
        var valSpan = document.createElement('span');
        valSpan.className = 'font-mono text-xs break-all';
        valSpan.textContent = String(t.value);
        td2.appendChild(valSpan);
        if (String(t.value).length === 64) {
          var copyBtn = document.createElement('button');
          copyBtn.setAttribute('data-copy-val', String(t.value));
          copyBtn.className = 'copy-val-btn ml-1 text-amber-400 hover:text-amber-300 text-xs';
          copyBtn.textContent = 'copy';
          td2.appendChild(copyBtn);
        }
      }
      if (t.rawHex) {
        var hexNote = document.createElement('span');
        hexNote.className = 'text-gray-500 text-xs';
        hexNote.textContent = ' (' + t.rawHex + ')';
        td2.appendChild(hexNote);
      }
      tr.appendChild(td2);
      table.appendChild(tr);
    }

    if (d.payee) {
      var payeeTr = document.createElement('tr');
      payeeTr.className = 'border-b border-gray-700/50';
      var payeeTd1 = document.createElement('td');
      payeeTd1.className = 'px-4 py-2 text-xs text-gray-500 font-mono whitespace-nowrap';
      payeeTd1.textContent = 'payee (recovered)';
      payeeTr.appendChild(payeeTd1);
      var payeeTd2 = document.createElement('td');
      payeeTd2.className = 'px-4 py-2 text-sm font-mono text-purple-300 break-all';
      payeeTd2.textContent = d.payee + ' ';
      var payeeCopyBtn = document.createElement('button');
      payeeCopyBtn.setAttribute('data-copy-val', d.payee);
      payeeCopyBtn.className = 'copy-val-btn ml-1 text-amber-400 hover:text-amber-300 text-xs';
      payeeCopyBtn.textContent = 'copy';
      payeeTd2.appendChild(payeeCopyBtn);
      payeeTr.appendChild(payeeTd2);
      table.appendChild(payeeTr);
    }

    document.getElementById('result-tags').replaceChildren(table);
  }

  function clearAll() {
    document.getElementById('invoice-input').value = '';
    document.getElementById('decode-error').classList.add('hidden');
    document.getElementById('decode-result').classList.add('hidden');
  }

  // Event delegation for data-action
  document.addEventListener('click', function(e) {
    var btn = e.target.closest('[data-action]');
    if (!btn) return;
    var action = btn.getAttribute('data-action');
    if (action === 'decode') decode();
    else if (action === 'clear') clearAll();
    else if (action === 'copy-val') {
      var val = btn.getAttribute('data-copy-val');
      if (val) navigator.clipboard.writeText(val).catch(function() {});
    }
  });

  // Ctrl/Cmd+Enter to decode
  document.getElementById('invoice-input').addEventListener('keydown', function(e) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') decode();
  });
})();`;
export const BOLT11_DECODE_JS_HASH = "f8b81a160586";

export const POS_JS = `// pos.js — classic script (no import/export)
// Depends on: nfc.js (browserSupportsNfc, createNfcScanner)

(function() {
  var posRoot = document.getElementById('pos-root');
  var CURRENCY_LABEL = posRoot ? posRoot.getAttribute('data-currency-label') || 'credits' : 'credits';

  // Result box helpers (inlined — same as operatorShared resultBoxHelpers)
  var resultBox = document.getElementById('result-box');
  var resultIcon = document.getElementById('result-icon');
  var resultTitle = document.getElementById('result-title');
  var resultMessage = document.getElementById('result-message');

  function showResult(kind, title, message) {
    resultBox.classList.remove('hidden');
    resultTitle.textContent = title;
    resultMessage.textContent = message;
    if (kind === 'success') {
      resultBox.className = 'rounded-xl border p-3 mb-3 border-emerald-500/40 bg-emerald-900/20';
      resultIcon.textContent = '\\u2713';
      resultIcon.className = 'text-xl leading-none text-emerald-400';
      resultTitle.className = 'font-bold text-sm text-emerald-300';
      resultMessage.className = 'text-xs mt-0.5 text-emerald-100/90';
    } else {
      resultBox.className = 'rounded-xl border p-3 mb-3 border-red-500/40 bg-red-900/20';
      resultIcon.textContent = '\\u2717';
      resultIcon.className = 'text-xl leading-none text-red-400';
      resultTitle.className = 'font-bold text-sm text-red-300';
      resultMessage.className = 'text-xs mt-0.5 text-red-100/90';
    }
  }

  function clearResult() {
    resultBox.className = 'hidden rounded-xl border p-3 mb-3';
  }

  var amountInput = '0';
  var appState = 'idle';
  var posScanner = null;
  var autoChargeTimer = null;
  var chargeAmount = '0';
  var posMode = localStorage.getItem('pos_mode') || 'free';
  var terminalId = localStorage.getItem('terminal_id') || '';
  var menuData = { items: [] };
  var cart = [];

  posScanner = createNfcScanner({
    continuous: false,
    debounceMs: 0,
    onError: function(err, phase) {
      if (appState !== 'scanning') return;
      stopScanning();
      setState('idle');
      if (phase === 'scan') showResult('error', 'NFC error', 'Try again');
      else if (phase !== 'permission') showResult('error', 'NFC error', err.message);
    },
    onTap: async function(data) {
      if (appState !== 'scanning') return;
      try {
        var nfcUrl = data.url;
        if (!nfcUrl) throw new Error('No URL on card');
        var parsed = new URL(nfcUrl);
        var p = parsed.searchParams.get('p');
        var c = parsed.searchParams.get('c');
        if (!p || !c) throw new Error('Card URL missing parameters');
        stopScanning();
        setState('processing');
        await directCharge(p, c);
       } catch (error) {
         if (typeof window.reportClientError === 'function') window.reportClientError(error, 'pos.js:nfc-tap');
         stopScanning();
         setState('failed');
         showResult('error', 'Payment failed', error.message);
       }
    }
  });

  if (!terminalId) {
    terminalId = crypto.randomUUID();
    localStorage.setItem('terminal_id', terminalId);
  }
  document.getElementById('terminal-id').textContent = terminalId.slice(0, 8);

  var amountDisplay = document.getElementById('amount-display');
  var keypadButtons = Array.from(document.querySelectorAll('.keypad-btn'));
  var chargeButton = document.getElementById('charge-btn');
  var newSaleButton = document.getElementById('new-sale-btn');
  var modeToggle = document.getElementById('mode-toggle');
  var modeFree = document.getElementById('mode-free');
  var modeMenu = document.getElementById('mode-menu');
  var menuGrid = document.getElementById('menu-grid');
  var menuItems = document.getElementById('menu-items');
  var menuEmpty = document.getElementById('menu-empty');
  var menuEditBtn = document.getElementById('menu-edit-btn');
  var cartTotal = document.getElementById('cart-total');
  var cartCount = document.getElementById('cart-count');
  var cartBar = document.getElementById('cart-bar');
  var cartItemsEl = document.getElementById('cart-items');
  var cartClearBtn = document.getElementById('cart-clear-btn');
  var tapOverlay = document.getElementById('tap-overlay');
  var overlayAmount = document.getElementById('overlay-amount');
  var overlayStatus = document.getElementById('overlay-status');
  var overlayCancel = document.getElementById('overlay-cancel');

  document.getElementById('keypad').addEventListener('click', function(e) { var btn = e.target.closest('[data-key]'); if (btn) handleKeypadInput(btn.dataset.key); });
  chargeButton.addEventListener('click', startChargeFlow);
  newSaleButton.addEventListener('click', resetSale);
  overlayCancel.addEventListener('click', cancelCharge);
  modeToggle.addEventListener('click', toggleMode);
  cartClearBtn.addEventListener('click', clearCart);
  menuEditBtn.addEventListener('click', function() { window.location.href = '/operator/pos/menu'; });
  window.addEventListener('beforeunload', stopScanning);

  applyMode();
  loadMenu();
  updateView();

  function normalizeAmount(value) {
    if (!value || value === '.') return '0';
    var next = String(value).replace(/[^0-9.]/g, '');
    var firstDecimal = next.indexOf('.');
    if (firstDecimal !== -1) { next = next.slice(0, firstDecimal + 1) + next.slice(firstDecimal + 1).replace(/\\./g, ''); }
    var parts = next.split('.');
    var whole = parts[0] || '0';
    var fraction = parts[1] || '';
    whole = whole.replace(/^0+(\\d)/, '$1');
    if (whole === '') whole = '0';
    return parts.length > 1 ? whole + '.' + fraction : whole;
  }

  function amountIsZero(value) { var n = Number(normalizeAmount(value)); return !Number.isFinite(n) || n <= 0; }

  function formatAmount(value) {
    var normalized = normalizeAmount(value);
    var parts = normalized.split('.');
    var whole = parts[0] || '0';
    var fraction = parts[1];
    return (whole.replace(/\\B(?=(\\d{3})+(?!\\d))/g, ',') + (fraction !== undefined ? '.' + fraction : '')) + ' ' + CURRENCY_LABEL;
  }

  function formatDisplayOnly(value) {
    var normalized = normalizeAmount(value);
    var parts = normalized.split('.');
    var whole = parts[0] || '0';
    return whole.replace(/\\B(?=(\\d{3})+(?!\\d))/g, ',') + (parts[1] !== undefined ? '.' + parts[1] : '');
  }

  function toggleMode() {
    posMode = posMode === 'free' ? 'menu' : 'free';
    localStorage.setItem('pos_mode', posMode);
    applyMode();
    clearCart();
    amountInput = '0';
    clearResult();
    updateView();
  }

  function applyMode() {
    if (posMode === 'menu') {
      modeToggle.textContent = 'KEYPAD';
      modeFree.classList.add('hidden');
      modeFree.classList.remove('flex');
      modeMenu.classList.remove('hidden');
      modeMenu.classList.add('flex');
    } else {
      modeToggle.textContent = 'MENU';
      modeFree.classList.remove('hidden');
      modeFree.classList.add('flex');
      modeMenu.classList.add('hidden');
      modeMenu.classList.remove('flex');
    }
  }

  function loadMenu() {
    fetch('/api/pos/menu?t=' + terminalId).then(function(r) { return r.json(); }).then(function(data) {
      if (data.items && data.items.length > 0) {
        menuData = data;
        renderMenuItems();
      }
    }).catch(function() {});
  }

  function renderMenuItems() {
    if (!menuData.items || menuData.items.length === 0) {
      menuEmpty.classList.remove('hidden');
      menuItems.classList.add('hidden');
      return;
    }
    menuEmpty.classList.add('hidden');
    menuItems.classList.remove('hidden');
    var fragment = document.createDocumentFragment();
    for (var i = 0; i < menuData.items.length; i++) {
      (function(idx) {
        var item = menuData.items[idx];
        var cartItem = cart.find(function(c) { return c.name === item.name; });
        var qty = cartItem ? cartItem.qty : 0;

        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'relative bg-gray-800 hover:bg-gray-700 active:bg-gray-600 border border-gray-700 rounded-lg p-3 transition-colors text-left';

        if (qty > 0) {
          var badge = document.createElement('span');
          badge.className = 'absolute -top-1 -right-1 bg-emerald-500 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center';
          badge.textContent = qty;
          btn.appendChild(badge);
        }

        var nameDiv = document.createElement('div');
        nameDiv.className = 'font-semibold text-sm text-gray-200';
        nameDiv.textContent = item.name;
        btn.appendChild(nameDiv);

        var priceDiv = document.createElement('div');
        priceDiv.className = 'text-emerald-400 font-bold text-lg';
        priceDiv.textContent = String(item.price);
        btn.appendChild(priceDiv);

        btn.addEventListener('click', function() { addToCart(menuData.items[idx]); });
        fragment.appendChild(btn);
      })(i);
    }
    menuItems.replaceChildren(fragment);
  }

  function addToCart(item) {
    var existing = cart.find(function(c) { return c.name === item.name; });
    if (existing) { existing.qty++; }
    else { cart.push({ name: item.name, price: item.price, qty: 1 }); }
    renderMenuItems();
    renderCart();
    updateView();
  }

  function clearCart() { cart = []; renderMenuItems(); renderCart(); updateView(); }

  function renderCart() {
    if (cart.length === 0) {
      cartBar.classList.add('hidden');
      cartCount.textContent = '';
      cartItemsEl.replaceChildren();
      return;
    }
    cartBar.classList.remove('hidden');
    var total = 0;
    var totalQty = 0;
    var fragment = document.createDocumentFragment();
    for (var i = 0; i < cart.length; i++) {
      var c = cart[i];
      var subtotal = c.price * c.qty;
      total += subtotal;
      totalQty += c.qty;
      var row = document.createElement('div');
      row.className = 'flex justify-between text-xs text-gray-400';
      var labelSpan = document.createElement('span');
      labelSpan.textContent = c.name + ' x' + c.qty;
      row.appendChild(labelSpan);
      var valSpan = document.createElement('span');
      valSpan.textContent = String(subtotal);
      row.appendChild(valSpan);
      fragment.appendChild(row);
    }
    cartItemsEl.replaceChildren(fragment);
    cartTotal.textContent = total + ' ' + CURRENCY_LABEL;
    cartCount.textContent = totalQty + ' item' + (totalQty !== 1 ? 's' : '');
  }

  function getCartTotal() {
    var total = 0;
    for (var i = 0; i < cart.length; i++) { total += cart[i].price * cart[i].qty; }
    return total;
  }

  function setState(next) { appState = next; updateView(); }

  function updateView() {
    amountDisplay.textContent = formatDisplayOnly(amountInput);
    var totalForCharge = posMode === 'menu' ? getCartTotal() : parseInt(normalizeAmount(amountInput), 10) || 0;
    var overlayActive = appState === 'charging' || appState === 'scanning' || appState === 'processing';
    if (overlayActive) {
      tapOverlay.classList.add('visible');
      overlayAmount.textContent = (posMode === 'menu' ? getCartTotal() : formatDisplayOnly(chargeAmount)) + ' ' + CURRENCY_LABEL;
    } else {
      tapOverlay.classList.remove('visible');
    }
    if (appState === 'charging' || appState === 'scanning') {
      overlayStatus.textContent = 'TAP CARD TO PAY';
      overlayStatus.className = 'text-lg font-bold text-emerald-400';
      overlayCancel.classList.remove('hidden');
    } else if (appState === 'processing') {
      overlayStatus.textContent = 'PROCESSING...';
      overlayStatus.className = 'text-lg font-bold text-amber-400';
      overlayCancel.classList.add('hidden');
    }
    var editingLocked = overlayActive;
    keypadButtons.forEach(function(b) { b.disabled = editingLocked; b.classList.toggle('opacity-40', editingLocked); });
    chargeButton.disabled = editingLocked || (posMode === 'menu' ? getCartTotal() <= 0 : amountIsZero(amountInput));
    newSaleButton.classList.toggle('hidden', !(appState === 'success' || appState === 'failed'));
    if (appState === 'idle' && !editingLocked) {
      var hasAmount = (posMode === 'menu' && getCartTotal() > 0) || (posMode === 'free' && !amountIsZero(amountInput));
      clearTimeout(autoChargeTimer);
      if (hasAmount && browserSupportsNfc()) {
        canAutoStartNfc().then(function(canAuto) {
          if (canAuto && appState === 'idle') {
            autoChargeTimer = setTimeout(function() { if (appState === 'idle') startChargeFlow(); }, 1000);
          }
        });
      }
    }
  }

  function handleKeypadInput(key) {
    if (appState !== 'idle') return;
    if (key === 'backspace') { amountInput = amountInput.length > 1 ? amountInput.slice(0, -1) : '0'; }
    else if (key === 'clear') { amountInput = '0'; }
    else if (key === '.') { if (!amountInput.includes('.')) amountInput += '.'; }
    else if (/^[0-9]$/.test(key)) { amountInput = amountInput === '0' ? key : amountInput + key; }
    amountInput = normalizeAmount(amountInput);
    clearResult();
    updateView();
  }

  function resetSale() { stopScanning(); amountInput = '0'; chargeAmount = '0'; clearCart(); clearResult(); setState('idle'); }
  function cancelCharge() { stopScanning(); setState('idle'); showResult('error', 'Cancelled', 'Charge cancelled'); }
  function stopScanning() { posScanner.stop(); clearTimeout(autoChargeTimer); }

  async function directCharge(p, c) {
    var amount = posMode === 'menu' ? getCartTotal() : parseInt(normalizeAmount(chargeAmount), 10);
    var items = posMode === 'menu' ? cart.map(function(c) { return { name: c.name, qty: c.qty, unitPrice: c.price }; }) : null;
    var resp = await fetch('/operator/pos/charge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ p: p, c: c, amount: amount, items: items, terminalId: terminalId }),
    });
    var data = await resp.json();
    if (resp.ok && data.success) {
      setState('success');
      showResult('success', 'Payment approved', (posMode === 'menu' ? getCartTotal() : formatDisplayOnly(chargeAmount)) + ' charged. Balance: ' + data.balance);
      if (posMode === 'menu') clearCart();
    } else {
      setState('failed');
      showResult('error', 'Payment failed', data.error || data.reason || 'Unknown error');
    }
  }

  async function startChargeFlow() {
    if (posMode === 'menu' && getCartTotal() <= 0) return;
    if (posMode === 'free' && amountIsZero(amountInput)) return;

    chargeAmount = posMode === 'menu' ? String(getCartTotal()) : normalizeAmount(amountInput);
    clearResult();
    stopScanning();
    setState('charging');

    try {
      await posScanner.scan();
      setState('scanning');
       } catch (error) {
         if (error.name !== 'AbortError') {
           if (typeof window.reportClientError === 'function') window.reportClientError(error, 'pos.js:nfc-scan');
           stopScanning();
           setState('idle');
           showResult('error', 'NFC error', error.message);
         }
       }
  }
})();`;
export const POS_JS_HASH = "a067fe6ad4ec";

export const TOPUP_JS = `// topup.js — classic script (no import/export)
// Depends on: nfc.js (browserSupportsNfc, createNfcScanner)

(function() {
  // Result box helpers (inlined)
  var resultBox = document.getElementById('result-box');
  var resultIcon = document.getElementById('result-icon');
  var resultTitle = document.getElementById('result-title');
  var resultMessage = document.getElementById('result-message');

  function showResult(kind, title, message) {
    resultBox.classList.remove('hidden');
    resultTitle.textContent = title;
    resultMessage.textContent = message;
    if (kind === 'success') {
      resultBox.className = 'w-full max-w-xs rounded-xl border p-4 mb-4 border-emerald-500/40 bg-emerald-900/20';
      resultIcon.textContent = '\\u2713';
      resultIcon.className = 'text-2xl leading-none text-emerald-400';
      resultTitle.className = 'font-bold text-sm text-emerald-300';
      resultMessage.className = 'text-xs mt-0.5 text-emerald-100/90';
    } else {
      resultBox.className = 'w-full max-w-xs rounded-xl border p-4 mb-4 border-red-500/40 bg-red-900/20';
      resultIcon.textContent = '\\u2717';
      resultIcon.className = 'text-2xl leading-none text-red-400';
      resultTitle.className = 'font-bold text-sm text-red-300';
      resultMessage.className = 'text-xs mt-0.5 text-red-100/90';
    }
  }

  function clearResult() {
    resultBox.className = 'hidden w-full max-w-xs rounded-xl border p-4 mb-4';
  }

  // Operator logout
  function operatorLogout() {
    fetch('/operator/logout', { method: 'POST' }).then(function() { window.location.href = '/operator/login'; });
  }

  // Amount helpers (integer-only)
  function normalizeAmount(val) {
    if (!val || val === '.') return '0';
    var s = String(val).replace(/[^0-9]/g, '');
    if (s === '') s = '0';
    s = s.replace(/^0+(\\d)/, '$1');
    return s;
  }

  function formatDisplay(val) {
    var n = normalizeAmount(val);
    return n.replace(/\\B(?=(\\d{3})+(?!\\d))/g, ',');
  }

  var amountInput = '0';
  var appState = 'idle';
  var nfcScanner = null;

  var amountDisplay = document.getElementById('amount-display');
  var keypad = document.getElementById('keypad');
  var nfcTapBtn = document.getElementById('nfc-tap-btn');
  var wedgeArea = document.getElementById('wedge-area');
  var wedgeInput = document.getElementById('wedge-input');
  var nfcBtnArea = document.getElementById('nfc-btn-area');
  var toggleWedge = document.getElementById('toggle-wedge');
  var logoutBtn = document.getElementById('logout-btn');

  nfcScanner = createNfcScanner({
    continuous: false,
    debounceMs: 0,
    onStatus: function(status) {
      if (status === 'scanning') { appState = 'scanning'; updateView(); }
    },
    onError: function(err, phase) {
      appState = 'idle';
      updateView();
      if (phase === 'scan') showResult('error', 'NFC error', 'Could not read card. Try again.');
      else if (phase !== 'permission') showResult('error', 'NFC error', err.message);
    },
    onTap: async function(data) {
      if (!data.url) { appState = 'idle'; updateView(); showResult('error', 'No card data', 'Could not read card URL'); return; }
      try {
        var parsed = new URL(data.url);
        var p = parsed.searchParams.get('p');
        var c = parsed.searchParams.get('c');
        if (p && c) { await submitTopup(p, c); }
        else { appState = 'idle'; updateView(); showResult('error', 'Invalid card data', 'Card URL missing p or c parameters'); }
       } catch(e) {
        if (typeof window.reportClientError === 'function') window.reportClientError(e, 'topup.js:card-read');
        appState = 'idle';
        updateView();
        showResult('error', 'Card read error', e.message);
      }
    }
  });

  keypad.addEventListener('click', function(e) {
    var btn = e.target.closest('[data-key]');
    if (!btn) return;
    handleKeypad(btn.dataset.key);
  });

  nfcTapBtn.addEventListener('click', function() {
    if (appState !== 'idle') return;
    clearResult();
    nfcScanner.scan();
  });
  toggleWedge.addEventListener('click', toggleWedgeMode);
  logoutBtn.addEventListener('click', operatorLogout);
  wedgeInput.addEventListener('keydown', handleWedgeInput);

  if (!browserSupportsNfc()) {
    toggleWedgeMode();
    toggleWedge.classList.add('hidden');
  } else {
    canAutoStartNfc().then(function(granted) {
      if (granted) {
        window.addEventListener('load', function() { clearResult(); nfcScanner.scan(); });
      }
      // If not granted, the nfc-tap-btn click handler provides the user gesture
    });
  }

  function handleKeypad(key) {
    if (appState !== 'idle') return;
    if (key === 'backspace') {
      amountInput = amountInput.length > 1 ? amountInput.slice(0, -1) : '0';
    } else if (key === 'clear') {
      amountInput = '0';
    } else if (/^[0-9]$/.test(key)) {
      amountInput = amountInput === '0' ? key : amountInput + key;
    }
    amountInput = normalizeAmount(amountInput);
    updateView();
  }

  function toggleWedgeMode() {
    var isHidden = wedgeArea.classList.contains('hidden');
    wedgeArea.classList.toggle('hidden');
    nfcBtnArea.classList.toggle('hidden');
    if (isHidden) {
      wedgeInput.focus();
      toggleWedge.textContent = 'NFC TAP';
    } else {
      nfcScanner.stop();
      toggleWedge.textContent = 'USB READER';
    }
  }

  function handleWedgeInput(e) {
    if (e.key !== 'Enter') return;
    var val = wedgeInput.value.trim();
    if (!val) return;
    wedgeInput.value = '';

    try {
      var url = new URL(val);
      var p = url.searchParams.get('p');
      var c = url.searchParams.get('c');
      if (p && c) {
        submitTopup(p, c);
        return;
      }
    } catch(_) {}

    showResult('error', 'Invalid card read', 'USB reader must output a URL with p and c parameters');
  }

  function updateView() {
    amountDisplay.textContent = formatDisplay(amountInput);
    nfcTapBtn.disabled = appState !== 'idle' || amountInput === '0';
    if (appState === 'idle') {
      nfcTapBtn.textContent = amountInput === '0' ? 'TAP CARD TO TOP UP' : 'SCANNING FOR CARD...';
    } else if (appState === 'scanning') {
      nfcTapBtn.textContent = 'SCANNING FOR CARD...';
    } else {
      nfcTapBtn.textContent = 'TAP CARD TO TOP UP';
    }
  }

  async function submitTopup(p, c) {
    if (appState !== 'idle') return;
    var amount = parseInt(normalizeAmount(amountInput), 10);
    if (!amount || amount <= 0) {
      showResult('error', 'Invalid amount', 'Enter an amount first');
      return;
    }
    appState = 'processing';
    updateView();
    try {
      var resp = await fetch('/operator/topup/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ p: p, c: c, amount: amount }),
      });
      var data = await resp.json();
      if (resp.ok && data.success) {
        showResult('success', 'Top-up successful', 'New balance: ' + (data.balance !== undefined ? data.balance : 'unknown'));
        amountInput = '0';
        updateView();
      } else {
        showResult('error', 'Top-up failed', data.error || data.reason || 'Unknown error');
      }
     } catch(e) {
       if (typeof window.reportClientError === 'function') window.reportClientError(e, 'topup.js:network');
       showResult('error', 'Network error', e.message || 'Could not reach server');
     }
    appState = 'idle';
    updateView();
  }

  updateView();
})();`;
export const TOPUP_JS_HASH = "2aaf6cc28c88";

export const REFUND_JS = `// refund.js — classic script (no import/export)
// Depends on: nfc.js (browserSupportsNfc, createNfcScanner)

(function() {
  // Result box helpers (inlined)
  var resultBox = document.getElementById('result-box');
  var resultIcon = document.getElementById('result-icon');
  var resultTitle = document.getElementById('result-title');
  var resultMessage = document.getElementById('result-message');

  function showResult(kind, title, message) {
    resultBox.classList.remove('hidden');
    resultTitle.textContent = title;
    resultMessage.textContent = message;
    if (kind === 'success') {
      resultBox.className = 'w-full max-w-xs rounded-xl border p-4 mb-4 border-emerald-500/40 bg-emerald-900/20';
      resultIcon.textContent = '\\u2713';
      resultIcon.className = 'text-2xl leading-none text-emerald-400';
      resultTitle.className = 'font-bold text-sm text-emerald-300';
      resultMessage.className = 'text-xs mt-0.5 text-emerald-100/90';
    } else {
      resultBox.className = 'w-full max-w-xs rounded-xl border p-4 mb-4 border-red-500/40 bg-red-900/20';
      resultIcon.textContent = '\\u2717';
      resultIcon.className = 'text-2xl leading-none text-red-400';
      resultTitle.className = 'font-bold text-sm text-red-300';
      resultMessage.className = 'text-xs mt-0.5 text-red-100/90';
    }
  }

  function clearResult() {
    resultBox.className = 'hidden w-full max-w-xs rounded-xl border p-4 mb-4';
  }

  // Operator logout
  function operatorLogout() {
    fetch('/operator/logout', { method: 'POST' }).then(function() { window.location.href = '/operator/login'; });
  }

  var appState = 'idle';
  var nfcScanner = null;
  var lastP = null;
  var lastC = null;

  var cardInfo = document.getElementById('card-info');
  var cardBalance = document.getElementById('card-balance');
  var refundOptions = document.getElementById('refund-options');
  var fullRefundBtn = document.getElementById('full-refund-btn');
  var partialRefundBtn = document.getElementById('partial-refund-btn');
  var partialAmount = document.getElementById('partial-amount');
  var nfcTapBtn = document.getElementById('nfc-tap-btn');
  var logoutBtn = document.getElementById('logout-btn');

  nfcScanner = createNfcScanner({
    continuous: false,
    debounceMs: 0,
    onStatus: function(status) {
      if (status === 'scanning') appState = 'scanning';
    },
    onError: function(err, phase) {
      appState = 'idle';
      if (phase === 'scan') showResult('error', 'NFC error', 'Try again');
      else if (phase !== 'permission') showResult('error', 'NFC error', err.message);
    },
    onTap: async function(data) {
      if (!data.url) { appState = 'idle'; showResult('error', 'No card data', 'Could not read card'); return; }
      try {
        var parsed = new URL(data.url);
        var p = parsed.searchParams.get('p');
        var c = parsed.searchParams.get('c');
        if (p && c) { lastP = p; lastC = c; await fetchBalance(p, c); }
        else { appState = 'idle'; showResult('error', 'Invalid card', 'Missing p/c parameters'); }
       } catch(e) {
        if (typeof window.reportClientError === 'function') window.reportClientError(e, 'refund.js:card-read');
        appState = 'idle';
        showResult('error', 'Error', e.message);
      }
    }
  });

  fullRefundBtn.addEventListener('click', function() { submitRefund(true, 0); });
  partialRefundBtn.addEventListener('click', function() {
    var amt = parseInt(partialAmount.value, 10);
    if (!amt || amt <= 0) { showResult('error', 'Invalid amount', 'Enter a positive amount'); return; }
    submitRefund(false, amt);
  });
  nfcTapBtn.addEventListener('click', function() { clearResult(); nfcScanner.scan(); });
  logoutBtn.addEventListener('click', operatorLogout);

  if (!browserSupportsNfc()) {
    nfcTapBtn.textContent = 'NFC NOT AVAILABLE — use Chrome on Android or USB reader';
    nfcTapBtn.disabled = true;
    nfcTapBtn.classList.add('opacity-50');
  } else {
    canAutoStartNfc().then(function(granted) {
      if (granted) {
        window.addEventListener('load', function() { nfcScanner.scan(); });
      }
      // If not granted, the nfc-tap-btn click handler provides the user gesture
    });
  }

  async function submitRefund(fullRefund, amount) {
    if (!lastP || !lastC) { showResult('error', 'No card', 'Tap a card first'); return; }
    appState = 'processing';
    try {
      var body = { p: lastP, c: lastC, fullRefund: fullRefund };
      if (!fullRefund) body.amount = amount;
      var resp = await fetch('/operator/refund/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      var data = await resp.json();
      if (resp.ok && data.success) {
        cardBalance.textContent = data.balance || 0;
        partialAmount.value = '';
        showResult('success', 'Refund issued', 'Refunded ' + data.amount + '. Remaining: ' + data.balance);
      } else {
        showResult('error', 'Refund failed', data.error || data.reason || 'Unknown error');
      }
     } catch(e) {
       if (typeof window.reportClientError === 'function') window.reportClientError(e, 'refund.js:network');
       showResult('error', 'Network error', e.message);
     }
    appState = 'idle';
  }

  async function fetchBalance(p, c) {
    try {
      var resp = await fetch('/api/balance-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ p: p, c: c }),
      });
      var data = await resp.json();
      if (resp.ok) {
        cardBalance.textContent = data.balance || 0;
        cardInfo.classList.remove('hidden');
        refundOptions.classList.remove('hidden');
        appState = 'idle';
      } else {
        appState = 'idle';
        showResult('error', 'Read failed', data.error || data.reason || 'Could not read card');
      }
     } catch(e) {
       if (typeof window.reportClientError === 'function') window.reportClientError(e, 'refund.js:network');
       appState = 'idle';
       showResult('error', 'Network error', e.message);
     }
  }
})();`;
export const REFUND_JS_HASH = "5692b2d9d56f";

export const RECONCILIATION_JS = `// reconciliation.js — classic script (no import/export)

(function() {
  var loadingEl = document.getElementById('loading');
  var contentEl = document.getElementById('content');
  var errorBox = document.getElementById('error-box');
  var errorMessage = document.getElementById('error-message');
  var refreshBtn = document.getElementById('refresh-btn');
  var logoutBtn = document.getElementById('logout-btn');

  var topupCount = document.getElementById('topup-count');
  var topupTotal = document.getElementById('topup-total');
  var chargeCount = document.getElementById('charge-count');
  var chargeTotal = document.getElementById('charge-total');
  var refundCount = document.getElementById('refund-count');
  var refundTotal = document.getElementById('refund-total');
  var voidCount = document.getElementById('void-count');
  var voidTotal = document.getElementById('void-total');
  var outstandingBalance = document.getElementById('outstanding-balance');
  var netCashIn = document.getElementById('net-cash-in');
  var varianceEl = document.getElementById('variance');
  var asOfEl = document.getElementById('as-of');
  var shiftTbody = document.getElementById('shift-tbody');
  var noShifts = document.getElementById('no-shifts');

  function showLoading() {
    loadingEl.classList.remove('hidden');
    contentEl.classList.add('hidden');
    errorBox.classList.add('hidden');
  }

  function showContent() {
    loadingEl.classList.add('hidden');
    contentEl.classList.remove('hidden');
    errorBox.classList.add('hidden');
  }

  function showError(msg) {
    loadingEl.classList.add('hidden');
    contentEl.classList.add('hidden');
    errorBox.classList.remove('hidden');
    errorMessage.textContent = msg;
  }

  function formatNum(n) {
    return String(n).replace(/\\B(?=(\\d{3})+(?!\\d))/g, ',');
  }

  function formatTime(ts) {
    var d = new Date(ts);
    var h = String(d.getHours()).padStart(2, '0');
    var m = String(d.getMinutes()).padStart(2, '0');
    return h + ':' + m;
  }

  function renderData(data) {
    var t = data.venueTotals;
    topupCount.textContent = formatNum(t.topupCount);
    topupTotal.textContent = formatNum(t.topupTotal);
    chargeCount.textContent = formatNum(t.chargeCount);
    chargeTotal.textContent = formatNum(t.chargeTotal);
    refundCount.textContent = formatNum(t.refundCount);
    refundTotal.textContent = formatNum(t.refundTotal);
    voidCount.textContent = formatNum(t.voidCount);
    voidTotal.textContent = formatNum(t.voidTotal);
    outstandingBalance.textContent = formatNum(t.outstandingBalance);
    netCashIn.textContent = formatNum(t.netCashIn);

    var diff = t.netCashIn - t.outstandingBalance;
    varianceEl.textContent = (diff >= 0 ? '+' : '') + formatNum(diff);
    varianceEl.className = 'text-lg font-bold ' + (diff === 0 ? 'text-emerald-400' : diff > 0 ? 'text-amber-400' : 'text-red-400');

    var now = new Date();
    asOfEl.textContent = 'As of ' + now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    shiftTbody.replaceChildren();
    var summaries = data.summaries || [];
    if (summaries.length === 0) {
      noShifts.classList.remove('hidden');
    } else {
      noShifts.classList.add('hidden');
      for (var i = 0; i < summaries.length; i++) {
        var s = summaries[i];
        var tr = document.createElement('tr');
        tr.className = 'border-b border-gray-700/50 text-gray-300';

        var tdId = document.createElement('td');
        tdId.className = 'px-3 py-2 font-mono';
        tdId.textContent = s.shiftId.slice(-8);

        var tdStarted = document.createElement('td');
        tdStarted.className = 'px-3 py-2';
        tdStarted.textContent = formatTime(s.startedAt);

        var tdTopups = document.createElement('td');
        tdTopups.className = 'px-3 py-2 text-right';
        tdTopups.textContent = String(s.topupCount);

        var tdCharges = document.createElement('td');
        tdCharges.className = 'px-3 py-2 text-right';
        tdCharges.textContent = String(s.chargeCount);

        var tdRefunds = document.createElement('td');
        tdRefunds.className = 'px-3 py-2 text-right';
        tdRefunds.textContent = String(s.refundCount);

        tr.appendChild(tdId);
        tr.appendChild(tdStarted);
        tr.appendChild(tdTopups);
        tr.appendChild(tdCharges);
        tr.appendChild(tdRefunds);
        shiftTbody.appendChild(tr);
      }
    }

    showContent();
  }

  async function loadData() {
    showLoading();
    try {
      var resp = await fetch('/operator/reconciliation/data');
      if (!resp.ok) {
        showError('Failed to load data (HTTP ' + resp.status + ')');
        return;
      }
      var data = await resp.json();
      renderData(data);
    } catch (e) {
      showError('Network error: ' + (e.message || 'Could not reach server'));
    }
  }

  function operatorLogout() {
    fetch('/operator/logout', { method: 'POST' }).then(function() { window.location.href = '/operator/login'; });
  }

  refreshBtn.addEventListener('click', loadData);
  logoutBtn.addEventListener('click', operatorLogout);

  loadData();
})();`;
export const RECONCILIATION_JS_HASH = "b4bc8ffa6960";

export const VOID_JS = `// void.js — classic script (no import/export)
// Depends on: nfc.js (browserSupportsNfc, createNfcScanner)

(function() {
  var resultBox = document.getElementById('result-box');
  var resultIcon = document.getElementById('result-icon');
  var resultTitle = document.getElementById('result-title');
  var resultMessage = document.getElementById('result-message');

  function showResult(kind, title, message) {
    resultBox.classList.remove('hidden');
    resultTitle.textContent = title;
    resultMessage.textContent = message;
    if (kind === 'success') {
      resultBox.className = 'w-full max-w-xs rounded-xl border p-4 mb-4 border-emerald-500/40 bg-emerald-900/20';
      resultIcon.textContent = '\\u2713';
      resultIcon.className = 'text-2xl leading-none text-emerald-400';
      resultTitle.className = 'font-bold text-sm text-emerald-300';
      resultMessage.className = 'text-xs mt-0.5 text-emerald-100/90';
    } else {
      resultBox.className = 'w-full max-w-xs rounded-xl border p-4 mb-4 border-red-500/40 bg-red-900/20';
      resultIcon.textContent = '\\u2717';
      resultIcon.className = 'text-2xl leading-none text-red-400';
      resultTitle.className = 'font-bold text-sm text-red-300';
      resultMessage.className = 'text-xs mt-0.5 text-red-100/90';
    }
  }

  function clearResult() {
    resultBox.className = 'hidden w-full max-w-xs rounded-xl border p-4 mb-4';
  }

  function operatorLogout() {
    fetch('/operator/logout', { method: 'POST' }).then(function() { window.location.href = '/operator/login'; });
  }

  function formatAmount(amount) {
    var abs = Math.abs(amount);
    var label = document.documentElement.dataset.currencyLabel || 'credits';
    return abs + ' ' + label;
  }

  function formatDate(epoch) {
    if (!epoch) return '';
    var d = new Date(epoch * 1000);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  var appState = 'idle';
  var nfcScanner = null;
  var lastP = null;
  var lastC = null;

  var cardInfo = document.getElementById('card-info');
  var cardBalance = document.getElementById('card-balance');
  var txnList = document.getElementById('txn-list');
  var txnItems = document.getElementById('txn-items');
  var nfcTapBtn = document.getElementById('nfc-tap-btn');
  var logoutBtn = document.getElementById('logout-btn');

  nfcScanner = createNfcScanner({
    continuous: false,
    debounceMs: 0,
    onStatus: function(status) {
      if (status === 'scanning') appState = 'scanning';
    },
    onError: function(err, phase) {
      appState = 'idle';
      if (phase === 'scan') showResult('error', 'NFC error', 'Try again');
      else if (phase !== 'permission') showResult('error', 'NFC error', err.message);
    },
    onTap: async function(data) {
      if (!data.url) { appState = 'idle'; showResult('error', 'No card data', 'Could not read card'); return; }
      try {
        var parsed = new URL(data.url);
        var p = parsed.searchParams.get('p');
        var c = parsed.searchParams.get('c');
        if (p && c) { lastP = p; lastC = c; await fetchTransactions(p, c); }
        else { appState = 'idle'; showResult('error', 'Invalid card', 'Missing p/c parameters'); }
       } catch(e) {
        if (typeof window.reportClientError === 'function') window.reportClientError(e, 'void.js:card-read');
        appState = 'idle';
        showResult('error', 'Error', e.message);
      }
    }
  });

  nfcTapBtn.addEventListener('click', function() { clearResult(); nfcScanner.scan(); });
  logoutBtn.addEventListener('click', operatorLogout);

  if (!browserSupportsNfc()) {
    nfcTapBtn.textContent = 'NFC NOT AVAILABLE — use Chrome on Android or USB reader';
    nfcTapBtn.disabled = true;
    nfcTapBtn.classList.add('opacity-50');
  } else {
    canAutoStartNfc().then(function(granted) {
      if (granted) {
        window.addEventListener('load', function() { nfcScanner.scan(); });
      }
      // If not granted, the nfc-tap-btn click handler provides the user gesture
    });
  }

  function renderTransactionList(transactions) {
    txnItems.replaceChildren();
    if (!transactions || transactions.length === 0) {
      var emptyEl = document.createElement('p');
      emptyEl.className = 'text-gray-500 text-sm text-center py-4';
      emptyEl.textContent = 'No recent charges to void';
      txnItems.appendChild(emptyEl);
      return;
    }

    transactions.forEach(function(txn) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'w-full flex items-center justify-between bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 hover:border-red-500/50 hover:bg-gray-750 transition-colors';

      var leftDiv = document.createElement('div');
      var amountEl = document.createElement('span');
      amountEl.className = 'text-white font-bold text-sm';
      amountEl.textContent = '-' + formatAmount(txn.amount);

      var noteEl = document.createElement('span');
      noteEl.className = 'text-gray-500 text-xs ml-2';
      noteEl.textContent = txn.note || '';

      leftDiv.appendChild(amountEl);
      leftDiv.appendChild(noteEl);

      var timeEl = document.createElement('span');
      timeEl.className = 'text-gray-500 text-xs';
      timeEl.textContent = formatDate(txn.created_at);

      btn.appendChild(leftDiv);
      btn.appendChild(timeEl);

      btn.addEventListener('click', function() { submitVoid(txn.id, txn.amount); });
      txnItems.appendChild(btn);
    });
  }

  async function submitVoid(transactionId, originalAmount) {
    if (!lastP || !lastC) { showResult('error', 'No card', 'Tap a card first'); return; }
    appState = 'processing';
    try {
      var resp = await fetch('/operator/void/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ p: lastP, c: lastC, transactionId: transactionId }),
      });
      var data = await resp.json();
      if (resp.ok && data.success) {
        cardBalance.textContent = data.balance || 0;
        showResult('success', 'Charge voided', 'Voided ' + formatAmount(originalAmount) + '. Balance: ' + data.balance);
        await fetchTransactions(lastP, lastC);
      } else {
        showResult('error', 'Void failed', data.error || data.reason || 'Unknown error');
      }
     } catch(e) {
      if (typeof window.reportClientError === 'function') window.reportClientError(e, 'void.js:network');
      showResult('error', 'Network error', e.message);
    }
    appState = 'idle';
  }

  async function fetchTransactions(p, c) {
    try {
      var resp = await fetch('/operator/void/transactions?p=' + encodeURIComponent(p) + '&c=' + encodeURIComponent(c));
      var data = await resp.json();
      if (resp.ok) {
        cardBalance.textContent = data.balance || 0;
        cardInfo.classList.remove('hidden');
        txnList.classList.remove('hidden');
        renderTransactionList(data.transactions);
        appState = 'idle';
      } else {
        appState = 'idle';
        showResult('error', 'Read failed', data.error || data.reason || 'Could not read card');
      }
     } catch(e) {
      if (typeof window.reportClientError === 'function') window.reportClientError(e, 'void.js:network');
      appState = 'idle';
      showResult('error', 'Network error', e.message);
    }
  }
})();`;
export const VOID_JS_HASH = "6cc60465ba90";

export const IDENTITY_JS = `// identity.js — classic script (no import/export)
// Depends on: nfc.js (browserSupportsNfc, createNfcScanner)

(function() {
  var ui = {
    idle: document.getElementById('state-idle'),
    scanning: document.getElementById('state-scanning'),
    verified: document.getElementById('state-verified'),
    denied: document.getElementById('state-denied'),
    panel: document.getElementById('card-panel'),
    btnScan: document.getElementById('btn-scan'),
    btnRetry: document.getElementById('btn-retry'),
    btnReset: document.getElementById('btn-reset'),
    noNfcMsg: document.getElementById('no-nfc-msg'),
    nfcStatus: document.getElementById('nfc-status')
  };

  var profile = {
    avatar: document.getElementById('profile-avatar'),
    name: document.getElementById('profile-name'),
    role: document.getElementById('profile-role'),
    dept: document.getElementById('profile-dept'),
    clearance: document.getElementById('profile-clearance'),
    uid: document.getElementById('profile-uid'),
    time: document.getElementById('profile-time'),
    reason: document.getElementById('error-reason'),
    openTwoFactor: document.getElementById('identity-open-2fa'),
    emojiSaveButton: document.getElementById('emoji-save-button'),
    emojiSaveStatus: document.getElementById('emoji-save-status'),
    emojiButtons: Array.from(document.querySelectorAll('.identity-emoji-btn')),
  };

  function iconSpan(cls, text) {
    var s = document.createElement('span');
    s.className = cls;
    s.textContent = text;
    return s;
  }

  var appState = 'idle';
  var currentVerification = null;
  var selectedEmoji = null;
  var nfcScanner = null;

  function setEmojiSelection(emoji) {
    selectedEmoji = emoji;
    profile.emojiButtons.forEach(function(button) {
      var active = button.dataset.emoji === emoji;
      button.classList.toggle('border-pink-400', active);
      button.classList.toggle('bg-pink-500/10', active);
      button.classList.toggle('scale-105', active);
    });
    profile.emojiSaveButton.disabled = !emoji;
  }

  function setSaveStatus(message, tone) {
    tone = tone || 'muted';
    var toneClass = tone === 'success'
      ? 'text-emerald-300'
      : tone === 'error'
        ? 'text-red-300'
        : 'text-gray-500';
    profile.emojiSaveStatus.className = 'text-xs ' + toneClass;
    profile.emojiSaveStatus.textContent = message;
  }

  function hydrateVerifiedProfile(result, verificationParams) {
    var profileData = result.profile || {};
    profile.avatar.textContent = profileData.emoji || '\\uD83D\\uDC64';
    profile.name.textContent = profileData.name || 'Operator';
    profile.role.textContent = profileData.role || 'Role';
    profile.dept.textContent = profileData.dept || 'Engineering';
    profile.clearance.textContent = profileData.level || 'Level 1';
    profile.uid.textContent = result.maskedUid;
    profile.time.textContent = new Date().toLocaleTimeString([], { hour12: false });
    currentVerification = verificationParams;
    profile.openTwoFactor.href = '/2fa?p=' + encodeURIComponent(verificationParams.p) + '&c=' + encodeURIComponent(verificationParams.c);
    setEmojiSelection(profileData.emoji || null);
    setSaveStatus('Pick an emoji to save it to this card profile.');
  }

  async function saveEmojiSelection() {
    if (!currentVerification || !selectedEmoji) {
      return;
    }

    profile.emojiSaveButton.disabled = true;
    setSaveStatus('Saving avatar choice...', 'muted');

    try {
      var response = await fetch('/api/identity/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          p: currentVerification.p,
          c: currentVerification.c,
          emoji: selectedEmoji,
        }),
      });
      var data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.reason || data.error || 'Unable to save avatar');
      }
      hydrateVerifiedProfile(Object.assign({}, data, { maskedUid: data.maskedUid || profile.uid.textContent }), currentVerification);
      setSaveStatus('Saved. This emoji will show the next time this card is verified.', 'success');
     } catch (error) {
       if (typeof window.reportClientError === 'function') window.reportClientError(error, 'identity.js:save-profile');
       setSaveStatus(error.message || 'Unable to save avatar.', 'error');
     } finally {
      profile.emojiSaveButton.disabled = !selectedEmoji;
    }
  }

  function setState(newState) {
    appState = newState;

    ['idle', 'scanning', 'verified', 'denied'].forEach(function(s) {
      ui[s].classList.add('hidden');
      ui[s].classList.remove('opacity-100');
      ui[s].classList.add('opacity-0');
    });

    ui.panel.className = 'w-full bg-gray-900/80 backdrop-blur-md rounded-2xl border border-gray-800 p-8 shadow-2xl transition-all duration-500 relative overflow-hidden flex flex-col items-center text-center';
    ui.nfcStatus.className = 'w-10 h-10 rounded-full border flex items-center justify-center transition-all duration-300';
    ui.nfcStatus.replaceChildren(iconSpan('text-gray-500', '\\u26A1'));

    var target = ui[newState];
    target.classList.remove('hidden');

    void target.offsetWidth; // Reflow

    target.classList.remove('opacity-0');
    target.classList.add('opacity-100');

    if (newState === 'verified') {
      ui.panel.classList.replace('border-gray-800', 'border-emerald-500/50');
      ui.panel.classList.add('shadow-[0_0_30px_rgba(16,185,129,0.15)]');
      ui.nfcStatus.classList.add('bg-emerald-500/20', 'border-emerald-500/50');
      ui.nfcStatus.replaceChildren(iconSpan('text-emerald-400', '\\u2713'));
    } else if (newState === 'denied') {
      ui.panel.classList.replace('border-gray-800', 'border-red-500/50');
      ui.panel.classList.add('shadow-[0_0_30px_rgba(239,68,68,0.15)]');
      ui.nfcStatus.classList.add('bg-red-500/20', 'border-red-500/50');
      ui.nfcStatus.replaceChildren(iconSpan('text-red-400', '\\u2717'));
    } else if (newState === 'scanning') {
      ui.panel.classList.replace('border-gray-800', 'border-blue-500/50');
      ui.nfcStatus.classList.add('bg-blue-500/20', 'border-blue-500/50', 'animate-pulse');
      ui.nfcStatus.replaceChildren(iconSpan('text-blue-400', '\\uD83D\\uDCF3'));
    } else {
      ui.nfcStatus.classList.add('bg-gray-900', 'border-gray-800');
    }
  }

  async function processNdefUrl(url) {
    setState('scanning');
    try {
      var parsed = new URL(url);
      var p = parsed.searchParams.get('p');
      var c = parsed.searchParams.get('c');

      if (!p || !c) {
        throw new Error('Invalid card payload');
      }

      var response = await fetch('/api/verify-identity?p=' + encodeURIComponent(p) + '&c=' + encodeURIComponent(c));
      var data = await response.json();

      if (data.verified) {
        hydrateVerifiedProfile(data, { p: p, c: c });
        setState('verified');
      } else {
        profile.reason.textContent = data.reason || 'Verification failed';
        setState('denied');
      }
     } catch (err) {
       if (typeof window.reportClientError === 'function') window.reportClientError(err, 'identity.js:verify');
       profile.reason.textContent = err.message || 'Network error';
       setState('denied');
     }
  }

  function initNfc() {
    var params = new URLSearchParams(window.location.search);
    var hasUrlCardParams = params.get('p') && params.get('c');

    nfcScanner = createNfcScanner({
      continuous: false,
      debounceMs: 0,
      onStatus: function(status) {
        if (status === 'scanning') setState('scanning');
      },
      onError: function(err, phase) {
        if (phase === 'permission') {
          ui.noNfcMsg.classList.remove('hidden');
          ui.btnScan.classList.remove('hidden');
        } else {
          profile.reason.textContent = err.message || 'Scan failed';
          setState('denied');
        }
      },
      onTap: async function(data) {
        if (data.url) {
          processNdefUrl(data.url);
        } else {
          processNdefUrl(window.location.origin + '/?p=&c=');
        }
      }
    });
    if (hasUrlCardParams) {
      processNdefUrl(window.location.href);
      return;
    }
    if (browserSupportsNfc()) {
      canAutoStartNfc().then(function(granted) {
        if (granted) {
          window.addEventListener('load', function() { nfcScanner.scan(); });
        } else {
          ui.btnScan.classList.remove('hidden');
        }
      });
    } else {
      ui.noNfcMsg.classList.remove('hidden');
    }
  }

  ui.btnScan.addEventListener('click', function() {
    setState('idle');
    if (nfcScanner) nfcScanner.restart();
  });

  ui.btnRetry.addEventListener('click', function() {
    setState('idle');
    if (nfcScanner) nfcScanner.restart();
  });

  ui.btnReset.addEventListener('click', function() {
    setState('idle');
    if (nfcScanner) nfcScanner.restart();
  });

  initNfc();

  profile.emojiButtons.forEach(function(button) {
    button.addEventListener('click', function() { setEmojiSelection(button.dataset.emoji); });
  });

  profile.emojiSaveButton.addEventListener('click', saveEmojiSelection);
  profile.emojiSaveButton.disabled = true;
})();`;
export const IDENTITY_JS_HASH = "21f4a9b9bfc4";

export const SW_REGISTER_JS = `// sw-register.js — classic script (no import/export)
// Registers the PWA service worker for offline support

(function() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(function() {});
  }
})();`;
export const SW_REGISTER_JS_HASH = "1da706e9bede";

export const HEALTH_JS = `// health.js — classic script (no import/export)

(function() {
  var loadingEl = document.getElementById('loading');
  var contentEl = document.getElementById('content');
  var errorBox = document.getElementById('error-box');
  var errorMessage = document.getElementById('error-message');
  var refreshBtn = document.getElementById('refresh-btn');
  var logoutBtn = document.getElementById('logout-btn');
  var lastUpdatedEl = document.getElementById('last-updated');

  var statusBadge = document.getElementById('status-badge');
  var kvStatus = document.getElementById('kv-status');
  var doStatus = document.getElementById('do-status');
  var versionEl = document.getElementById('version');
  var responseTimeEl = document.getElementById('response-time');

  var cardTotal = document.getElementById('card-total');
  var cardActive = document.getElementById('card-active');
  var cardDiscovered = document.getElementById('card-discovered');
  var cardPending = document.getElementById('card-pending');
  var cardKeysDelivered = document.getElementById('card-keys-delivered');
  var cardTerminated = document.getElementById('card-terminated');

  var finTopupCount = document.getElementById('fin-topup-count');
  var finTopupTotal = document.getElementById('fin-topup-total');
  var finChargeCount = document.getElementById('fin-charge-count');
  var finChargeTotal = document.getElementById('fin-charge-total');
  var finRefundCount = document.getElementById('fin-refund-count');
  var finRefundTotal = document.getElementById('fin-refund-total');
  var finVoidCount = document.getElementById('fin-void-count');
  var finVoidTotal = document.getElementById('fin-void-total');
  var finOutstanding = document.getElementById('fin-outstanding');
  var finNetCash = document.getElementById('fin-net-cash');

  var eventsTbody = document.getElementById('events-tbody');
  var noEvents = document.getElementById('no-events');

  var refreshTimer = null;
  var firstLoad = true;
  var REFRESH_INTERVAL = 30000;

  function showLoading() {
    loadingEl.classList.remove('hidden');
    contentEl.classList.add('hidden');
    errorBox.classList.add('hidden');
  }

  function showContent() {
    loadingEl.classList.add('hidden');
    contentEl.classList.remove('hidden');
    errorBox.classList.add('hidden');
  }

  function showError(msg) {
    loadingEl.classList.add('hidden');
    contentEl.classList.add('hidden');
    errorBox.classList.remove('hidden');
    errorMessage.textContent = msg;
  }

  function formatNum(n) {
    return Number(n || 0).toLocaleString();
  }

  function formatClock(ms) {
    var d = new Date(ms);
    var h = String(d.getHours()).padStart(2, '0');
    var m = String(d.getMinutes()).padStart(2, '0');
    var s = String(d.getSeconds()).padStart(2, '0');
    return h + ':' + m + ':' + s;
  }

  function relativeTime(epochMs) {
    var now = Date.now();
    var diff = Math.floor((now - epochMs) / 1000);
    if (diff < 0) return 'just now';
    if (diff < 60) return diff + 's ago';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    return Math.floor(diff / 86400) + 'd ago';
  }

  function setStatusBadge(overall) {
    var label, cls;
    if (overall === 'healthy') {
      label = 'HEALTHY';
      cls = 'px-3 py-1 rounded-full text-xs font-semibold bg-emerald-900/50 border border-emerald-700 text-emerald-400';
    } else if (overall === 'degraded') {
      label = 'DEGRADED';
      cls = 'px-3 py-1 rounded-full text-xs font-semibold bg-amber-900/50 border border-amber-700 text-amber-400';
    } else {
      label = 'DOWN';
      cls = 'px-3 py-1 rounded-full text-xs font-semibold bg-red-900/50 border border-red-700 text-red-400';
    }
    statusBadge.textContent = label;
    statusBadge.className = cls;
  }

  function renderSystemIndicator(el, status) {
    if (status === 'ok') {
      el.textContent = '\\u2713 OK';
      el.className = 'text-lg font-bold text-emerald-400';
    } else {
      el.textContent = '\\u2717 ERROR';
      el.className = 'text-lg font-bold text-red-400';
    }
  }

  function actionLabel(action) {
    var labels = {
      topup: 'Top-up',
      charge: 'Charge',
      refund: 'Refund',
      void: 'Void',
      terminate: 'Terminate',
      wipe: 'Wipe',
      activate: 'Activate'
    };
    return labels[action] || action;
  }

  function actionColor(action) {
    var colors = {
      topup: 'text-emerald-400',
      charge: 'text-blue-400',
      refund: 'text-amber-400',
      void: 'text-red-400',
      terminate: 'text-red-400',
      wipe: 'text-orange-400',
      activate: 'text-cyan-400'
    };
    return colors[action] || 'text-gray-300';
  }

  function renderData(data) {
    var sys = data.system || {};
    setStatusBadge(sys.overall || 'down');
    renderSystemIndicator(kvStatus, sys.kv);
    renderSystemIndicator(doStatus, sys.durableObject);

    versionEl.textContent = data.version || '\\u2014';
    if (data.responseTimeMs != null) {
      responseTimeEl.textContent = data.responseTimeMs + ' ms';
    }

    var c = data.cards || {};
    cardTotal.textContent = formatNum(c.total);
    cardActive.textContent = formatNum(c.active);
    cardDiscovered.textContent = formatNum(c.discovered);
    cardPending.textContent = formatNum(c.pending);
    cardKeysDelivered.textContent = formatNum(c.keys_delivered);
    cardTerminated.textContent = formatNum(c.terminated);

    var f = data.financials || {};
    finTopupCount.textContent = formatNum(f.topupCount) + ' txns';
    finTopupTotal.textContent = formatNum(f.topupTotal);
    finChargeCount.textContent = formatNum(f.chargeCount) + ' txns';
    finChargeTotal.textContent = formatNum(f.chargeTotal);
    finRefundCount.textContent = formatNum(f.refundCount) + ' txns';
    finRefundTotal.textContent = formatNum(f.refundTotal);
    finVoidCount.textContent = formatNum(f.voidCount) + ' txns';
    finVoidTotal.textContent = formatNum(f.voidTotal);
    finOutstanding.textContent = formatNum(f.outstandingBalance);
    finNetCash.textContent = formatNum(f.netCashIn);

    eventsTbody.replaceChildren();
    var events = data.recentEvents || [];
    if (events.length === 0) {
      noEvents.classList.remove('hidden');
    } else {
      noEvents.classList.add('hidden');
      for (var i = 0; i < events.length; i++) {
        var ev = events[i];
        var tr = document.createElement('tr');
        tr.className = 'border-b border-gray-700/50 text-gray-300';

        var tdTime = document.createElement('td');
        tdTime.className = 'px-3 py-2';
        tdTime.textContent = ev.timestamp ? relativeTime(ev.timestamp) : '\\u2014';

        var tdAction = document.createElement('td');
        tdAction.className = 'px-3 py-2 font-semibold ' + actionColor(ev.action);
        tdAction.textContent = actionLabel(ev.action);

        var tdUid = document.createElement('td');
        tdUid.className = 'px-3 py-2 font-mono text-gray-500';
        tdUid.textContent = ev.uid ? ev.uid.slice(0, 8) : '\\u2014';

        var tdAmount = document.createElement('td');
        tdAmount.className = 'px-3 py-2 text-right';
        if (ev.details && ev.details.amount != null) {
          tdAmount.textContent = formatNum(ev.details.amount);
        } else {
          tdAmount.textContent = '\\u2014';
        }

        tr.appendChild(tdTime);
        tr.appendChild(tdAction);
        tr.appendChild(tdUid);
        tr.appendChild(tdAmount);
        eventsTbody.appendChild(tr);
      }
    }

    lastUpdatedEl.textContent = 'Updated ' + formatClock(Date.now());
    showContent();
  }

  async function loadData() {
    if (firstLoad) {
      showLoading();
    }
    try {
      var resp = await fetch('/operator/health/data');
      if (!resp.ok) {
        showError('Failed to load data (HTTP ' + resp.status + ')');
        return;
      }
      var data = await resp.json();
      renderData(data);
      firstLoad = false;
    } catch (e) {
      showError('Network error: ' + (e.message || 'Could not reach server'));
    }
  }

  function operatorLogout() {
    fetch('/operator/logout', { method: 'POST' }).then(function() { window.location.href = '/operator/login'; });
  }

  function startAutoRefresh() {
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(loadData, REFRESH_INTERVAL);
  }

  refreshBtn.addEventListener('click', loadData);
  logoutBtn.addEventListener('click', operatorLogout);

  loadData();
  startAutoRefresh();
})();`;
export const HEALTH_JS_HASH = "d2896064452e";

export const CREDENTIAL_JS = `(function () {
  "use strict";

  window._nfcPageHandler = true;

  var elIdle = document.getElementById("state-idle");
  var elLoading = document.getElementById("state-loading");
  var elIssued = document.getElementById("state-issued");
  var elError = document.getElementById("state-error");
  var elNfcStatus = document.getElementById("nfc-status");
  var elScanHint = document.getElementById("scan-hint");
  var elNoNfc = document.getElementById("no-nfc-msg");

  function showState(el) {
    [elIdle, elLoading, elIssued, elError].forEach(function (s) {
      s.classList.add("hidden");
      s.classList.add("opacity-0");
    });
    el.classList.remove("hidden");
    el.classList.remove("opacity-0");
  }

  function showError(msg) {
    var elMsg = document.getElementById("error-msg");
    elMsg.textContent = msg || "Unknown error";
    showState(elError);
  }

  var lastP = null;
  var lastC = null;

  var PROFILE_KEY = "vc_profile";

  function loadProfile() {
    try { return JSON.parse(localStorage.getItem(PROFILE_KEY) || "{}"); } catch (e) { return {}; }
  }

  function saveProfile() {
    try {
      var p = {
        name: (document.getElementById("profile-name").value || "").trim(),
        role: (document.getElementById("profile-role").value || "").trim(),
        dept: (document.getElementById("profile-dept").value || "").trim(),
        level: (document.getElementById("profile-level").value || "").trim(),
      };
      localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
    } catch (e) {}
  }

  function fillProfileInputs() {
    var p = loadProfile();
    document.getElementById("profile-name").value = p.name || "";
    document.getElementById("profile-role").value = p.role || "";
    document.getElementById("profile-dept").value = p.dept || "";
    document.getElementById("profile-level").value = p.level || "";
  }

  function buildProfileQuery() {
    var p = loadProfile();
    var parts = [];
    if (p.name) parts.push("name=" + encodeURIComponent(p.name));
    if (p.role) parts.push("role=" + encodeURIComponent(p.role));
    if (p.dept) parts.push("dept=" + encodeURIComponent(p.dept));
    if (p.level) parts.push("level=" + encodeURIComponent(p.level));
    return parts.length ? "&" + parts.join("&") : "";
  }

  async function issueCredential(p, c, alg) {
    showState(elLoading);
    var url = "/api/credential?p=" + encodeURIComponent(p) + "&c=" + encodeURIComponent(c);
    if (alg) url += "&alg=" + encodeURIComponent(alg);
    url += buildProfileQuery();
    try {
      var resp = await fetch(url);
      if (!resp.ok) {
        var errBody = await resp.json().catch(function () { return {}; });
        showError(errBody.reason || errBody.error || "HTTP " + resp.status);
        return;
      }
      var data = await resp.json();
      lastP = p;
      lastC = c;
      displayCredential(data, alg);
    } catch (e) {
      showError(String(e.message || e));
    }
  }

  function displayCredential(data, requestedAlg) {
    var payload = data.decoded;
    if (!payload) {
      showError("Failed to decode credential");
      return;
    }

    var subject = payload.vc ? payload.vc.credentialSubject : null;
    if (subject) {
      document.getElementById("claim-name").textContent = subject.name || "—";
      document.getElementById("claim-role").textContent = subject.role || "—";
      document.getElementById("claim-dept").textContent = subject.department || "—";
      document.getElementById("claim-clearance").textContent = subject.clearance || "—";
      document.getElementById("claim-uid").textContent = subject.cardUid || "—";
    }

    document.getElementById("issuer-did").textContent = data.issuer || payload.iss || "—";
    document.getElementById("vc-jwt-display").textContent = data.credential || "—";
    document.getElementById("credential-alg").textContent = data.alg || requestedAlg || "ES256";

    var now = new Date();
    document.getElementById("credential-time").textContent = now.toLocaleTimeString();

    window._vcJwt = data.credential;

    var btnToggle = document.getElementById("btn-toggle-alg");
    if (data.alg === "EdDSA") {
      btnToggle.textContent = "Re-issue as ES256";
    } else {
      btnToggle.textContent = "Re-issue as EdDSA";
    }

    showState(elIssued);
  }

  async function verifyCredential(jwt) {
    var elResult = document.getElementById("verify-result");
    var elStatus = document.getElementById("verify-status");
    var elDetails = document.getElementById("verify-details");

    elStatus.textContent = "Verifying...";
    elDetails.textContent = "";
    elResult.classList.remove("hidden");

    try {
      var resp = await fetch("/api/verify-credential", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credential: jwt }),
      });
      var data = await resp.json();

      if (data.valid) {
        elStatus.textContent = "✓ VALID";
        elStatus.className = "text-sm font-bold mb-2 text-emerald-400";
        var p = data.payload;
        if (p && p.vc) {
          var s = p.vc.credentialSubject;
          elDetails.textContent =
            "Subject: " + (s ? s.name : "—") +
            " | UID: " + (s ? s.cardUid : "—") +
            " | Expires: " + (p.exp ? new Date(p.exp * 1000).toISOString() : "—");
        }
      } else {
        elStatus.textContent = "✗ INVALID";
        elStatus.className = "text-sm font-bold mb-2 text-red-400";
        elDetails.textContent = data.error || "Verification failed";
      }
    } catch (e) {
      elStatus.textContent = "✗ ERROR";
      elStatus.className = "text-sm font-bold mb-2 text-red-400";
      elDetails.textContent = String(e.message || e);
    }
  }

  function startNfcScan() {
    if (!("NDEFReader" in window)) {
      elNoNfc.classList.remove("hidden");
      return;
    }

    try {
      var ndef = new NDEFReader();
      ndef.onreading = function (event) {
        var url = "";
        for (var i = 0; i < event.message.records.length; i++) {
          var record = event.message.records[i];
          if (record.recordType === "url" || record.recordType === "text") {
            url = new TextDecoder().decode(record.data);
            break;
          }
        }
        if (!url) return;

        var parsedUrl;
        try { parsedUrl = new URL(url); } catch (e) { return; }

        var p = parsedUrl.searchParams.get("p");
        var c = parsedUrl.searchParams.get("c");
        if (p && c) {
          issueCredential(p, c);
        }
      };

      ndef.onreadingerror = function () {
        elScanHint.textContent = "Read error — try again";
      };

      ndef.scan().then(function () {
        elScanHint.classList.remove("hidden");
        elNfcStatus.classList.add("bg-purple-500/20", "border-purple-500/40");
        elNfcStatus.classList.remove("bg-gray-900", "border-gray-800");
      }).catch(function () {
        elScanHint.textContent = "NFC scan failed to start";
      });
    } catch (e) {
      elNoNfc.classList.remove("hidden");
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    fillProfileInputs();

    var profileToggle = document.getElementById("profile-toggle");
    var profileContent = document.getElementById("profile-content");
    var profileChevron = document.getElementById("profile-chevron");
    if (profileToggle) {
      profileToggle.addEventListener("click", function () {
        var isHidden = profileContent.classList.contains("hidden");
        profileContent.classList.toggle("hidden", !isHidden);
        if (profileChevron) profileChevron.style.transform = isHidden ? "rotate(180deg)" : "rotate(0deg)";
      });
    }

    ["profile-name", "profile-role", "profile-dept", "profile-level"].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener("input", saveProfile);
    });

    startNfcScan();

    window._vcTapCredential = function (p, c) {
      issueCredential(p, c);
    };

    var _origVcTap = window._vcTap;
    if (typeof _origVcTap === 'function') {
      window._vcTap = function() {
        var t = _origVcTap();
        if (t && t.p && t.c) {
          issueCredential(t.p, t.c);
          return null;
        }
        return t;
      };
    }

    var btnCopy = document.getElementById("btn-copy-jwt");
    function copyToClipboard(text, btn, originalText) {
      if (!text) return;
      if (navigator.clipboard) {
        navigator.clipboard.writeText(text).then(function () {
          btn.textContent = "Copied!";
          setTimeout(function () { btn.textContent = originalText; }, 2000);
        });
      }
    }
    if (btnCopy) {
      btnCopy.addEventListener("click", function () {
        copyToClipboard(window._vcJwt || "", btnCopy, "Copy Credential");
      });
    }

    var btnCopyJwtInline = document.getElementById("btn-copy-jwt-inline");
    if (btnCopyJwtInline) {
      btnCopyJwtInline.addEventListener("click", function () {
        copyToClipboard(window._vcJwt || "", btnCopyJwtInline, "copy");
      });
    }

    var btnCopyDid = document.getElementById("btn-copy-did");
    if (btnCopyDid) {
      btnCopyDid.addEventListener("click", function () {
        var did = document.getElementById("issuer-did").textContent || "";
        copyToClipboard(did, btnCopyDid, "copy");
      });
    }

    function makeClickToSelect(el) {
      if (!el) return;
      el.addEventListener("click", function () {
        var range = document.createRange();
        range.selectNodeContents(el);
        var sel = window.getSelection();
        if (sel) { sel.removeAllRanges(); sel.addRange(range); }
      });
    }
    makeClickToSelect(document.getElementById("issuer-did"));
    makeClickToSelect(document.getElementById("vc-jwt-display"));

    var btnToggleAlg = document.getElementById("btn-toggle-alg");
    if (btnToggleAlg) {
      btnToggleAlg.addEventListener("click", function () {
        if (!lastP || !lastC) return;
        var currentAlg = document.getElementById("credential-alg").textContent;
        var newAlg = currentAlg === "EdDSA" ? "ES256" : "EdDSA";
        issueCredential(lastP, lastC, newAlg);
      });
    }

    var btnReset = document.getElementById("btn-reset");
    if (btnReset) {
      btnReset.addEventListener("click", function () {
        showState(elIdle);
        window._vcJwt = null;
        lastP = null;
        lastC = null;
      });
    }

    var btnRetry = document.getElementById("btn-retry");
    if (btnRetry) {
      btnRetry.addEventListener("click", function () {
        showState(elIdle);
      });
    }

    var btnVerifyInput = document.getElementById("btn-verify-input");
    if (btnVerifyInput) {
      btnVerifyInput.addEventListener("click", function () {
        var input = document.getElementById("verify-input");
        var jwt = (input.value || "").trim();
        if (!jwt) return;
        verifyCredential(jwt);
      });
    }
  });
})();`;
export const CREDENTIAL_JS_HASH = "53ea83dc14af";

export const NOSTR_PAIRING_JS = `(function () {
  "use strict";

  window._nfcPageHandler = true;

  var nostrNpub = null;

  function $(id) { return document.getElementById(id); }

  function showSection(prefix) {
    ["pair-idle", "pair-loading", "pair-success", "pair-error"].forEach(function (s) {
      $(s).classList.add("hidden");
    });
    $(prefix).classList.remove("hidden");
  }

  function showError(msg) {
    $("pair-error-msg").textContent = msg || "Unknown error";
    showSection("pair-error");
  }

  // ─── NIP-07: Connect Nostr Identity ───────────────────────────
  function checkNip07() {
    return typeof window.nostr !== "undefined" &&
           typeof window.nostr.getPublicKey === "function";
  }

  $("btn-connect-nostr").addEventListener("click", async function () {
    if (!checkNip07()) {
      $("nip07-missing").classList.remove("hidden");
      $("nip07-available").classList.add("hidden");
      return;
    }

    try {
      var npub = await window.nostr.getPublicKey();
      if (!npub || !npub.startsWith("npub1")) {
        showError("Invalid public key returned");
        return;
      }
      nostrNpub = npub;
      $("nostr-npub").textContent = npub;
      $("nip07-available").classList.add("hidden");
      $("nostr-connected").classList.remove("hidden");
    } catch (e) {
      showError(String(e.message || e));
    }
  });

  // ─── NFC scanning ──────────────────────────────────────────────
  function startNfcScan() {
    if (!("NDEFReader" in window)) {
      $("no-nfc-msg").classList.remove("hidden");
      $("btn-use-virtual").classList.remove("hidden");
      return;
    }

    try {
      var ndef = new NDEFReader();
      ndef.onreading = function (event) {
        var url = "";
        for (var i = 0; i < event.message.records.length; i++) {
          var record = event.message.records[i];
          if (record.recordType === "url" || record.recordType === "text") {
            url = new TextDecoder().decode(record.data);
            break;
          }
        }
        if (!url) return;
        try {
          var parsed = new URL(url);
          var p = parsed.searchParams.get("p");
          var c = parsed.searchParams.get("c");
          if (p && c && nostrNpub) doPair(p, c);
        } catch (e) { return; }
      };

      ndef.scan().then(function () {
        $("scan-hint").classList.remove("hidden");
      }).catch(function () {
        $("scan-hint").textContent = "NFC scan failed — use virtual card";
        $("btn-use-virtual").classList.remove("hidden");
      });
    } catch (e) {
      $("no-nfc-msg").classList.remove("hidden");
      $("btn-use-virtual").classList.remove("hidden");
    }
  }

  // ─── Virtual card hook ─────────────────────────────────────────
  window._vcTapPair = function (p, c) {
    if (!nostrNpub) {
      showError("Connect your Nostr identity first");
      return;
    }
    doPair(p, c);
  };

  $("btn-use-virtual").addEventListener("click", function () {
    if (typeof window._vcTap === "function") {
      var t = window._vcTap();
      if (t && nostrNpub) doPair(t.p, t.c);
    } else {
      window.location.href = "/virtual";
    }
  });

  // ─── Pair / Unpair API ─────────────────────────────────────────
  async function doPair(p, c) {
    showSection("pair-loading");
    try {
      var csrfMatch = document.cookie.match(/op_csrf=([^;]+)/);
      var headers = { "Content-Type": "application/json" };
      if (csrfMatch) headers["X-CSRF-Token"] = csrfMatch[1];

      var resp = await fetch("/api/pair-nostr", {
        method: "POST",
        headers: headers,
        body: JSON.stringify({ p: p, c: c, npub: nostrNpub }),
      });
      var data = await resp.json();
      if (data.success) {
        showSection("pair-success");
      } else {
        showError(data.reason || data.error || "HTTP " + resp.status);
      }
    } catch (e) {
      showError(String(e.message || e));
    }
  }

  $("btn-unpair").addEventListener("click", async function () {
    if (!confirm("Remove the Nostr identity pairing from this card?")) return;
    var btn = $("btn-unpair");
    btn.textContent = "Unpairing...";
    btn.disabled = true;

    try {
      if (typeof window._vcTap === "function") {
        var t = window._vcTap();
        var csrfMatch = document.cookie.match(/op_csrf=([^;]+)/);
        var headers = { "Content-Type": "application/json" };
        if (csrfMatch) headers["X-CSRF-Token"] = csrfMatch[1];

        var resp = await fetch("/api/unpair-nostr", {
          method: "POST",
          headers: headers,
          body: JSON.stringify({ p: t.p, c: t.c }),
        });
        var data = await resp.json();
        if (data.success) {
          showSection("pair-idle");
          $("nostr-connected").classList.add("hidden");
          $("nip07-available").classList.remove("hidden");
          nostrNpub = null;
        }
      }
    } catch (e) {
      btn.textContent = "Unpair Failed";
    }
  });

  $("btn-retry-pair").addEventListener("click", function () {
    showSection("pair-idle");
  });

  // ─── Init ──────────────────────────────────────────────────────
  document.addEventListener("DOMContentLoaded", function () {
    if (!checkNip07()) {
      $("nip07-missing").classList.remove("hidden");
      $("nip07-available").classList.add("hidden");
    }
    startNfcScan();
  });
})();`;
export const NOSTR_PAIRING_JS_HASH = "07167d8ff1db";

export const VERIFY_JS = `(function () {
  "use strict";

  function init() {
    var input = document.getElementById("verify-input");
    var btnVerify = document.getElementById("btn-verify");
    var btnClear = document.getElementById("btn-clear");
    var resultSection = document.getElementById("result-section");
    var resultTitle = document.getElementById("result-title");
    var resultBadge = document.getElementById("result-badge");
    var resultDetails = document.getElementById("result-details");

    if (!btnVerify || !input) return;

    btnVerify.addEventListener("click", async function () {
      var cred = (input.value || "").trim();
      if (!cred) return;

      resultSection.classList.remove("hidden");
      resultTitle.textContent = "Verifying...";
      resultBadge.textContent = "...";
      resultBadge.className = "text-xs font-bold px-3 py-1 rounded-full bg-gray-700 text-gray-300";
      resultDetails.replaceChildren();

      try {
        var resp = await fetch("/api/verify-credential", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ credential: cred }),
        });
        var data = await resp.json();

        if (data.valid) {
          resultTitle.textContent = "Valid Credential";
          resultBadge.textContent = "\\u2713 VALID";
          resultBadge.className = "text-xs font-bold px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30";

          var p = data.payload || {};
          var s = (p.vc && p.vc.credentialSubject) || {};
          var rows = [
            ["Subject", s.name || "\\u2014"],
            ["Role", s.role || "\\u2014"],
            ["Department", s.department || "\\u2014"],
            ["Card UID", s.cardUid || "\\u2014"],
            ["Issuer", (data.issuer || p.iss || "\\u2014").substring(0, 60) + "..."],
            ["Algorithm", data.alg || p.alg || "\\u2014"],
            ["Issued", p.iat ? new Date(p.iat * 1000).toISOString() : "\\u2014"],
            ["Expires", p.exp ? new Date(p.exp * 1000).toISOString() : "\\u2014"],
          ];

          if (s.nostrNpub) rows.push(["Nostr", s.nostrNpub]);
          if (s.nostrName) rows.push(["Nostr Name", s.nostrName]);

          resultDetails.replaceChildren();
          rows.forEach(function (row) {
            var row_el = document.createElement("div");
            row_el.className = "flex justify-between items-center border-b border-gray-800/50 pb-2";
            var label = document.createElement("span");
            label.className = "text-xs text-gray-500 uppercase tracking-wider";
            label.textContent = row[0];
            var value = document.createElement("span");
            value.className = "text-sm font-mono text-gray-300 text-right";
            value.textContent = row[1];
            row_el.appendChild(label);
            row_el.appendChild(value);
            resultDetails.appendChild(row_el);
          });
        } else {
          resultTitle.textContent = "Invalid Credential";
          resultBadge.textContent = "\\u2717 INVALID";
          resultBadge.className = "text-xs font-bold px-3 py-1 rounded-full bg-red-500/20 text-red-400 border border-red-500/30";
          var err_el = document.createElement("p");
          err_el.className = "text-sm text-red-400";
          err_el.textContent = data.error || "Verification failed";
          resultDetails.appendChild(err_el);
        }
      } catch (e) {
        resultTitle.textContent = "Error";
        resultBadge.textContent = "\\u2717 ERROR";
        resultBadge.className = "text-xs font-bold px-3 py-1 rounded-full bg-red-500/20 text-red-400 border border-red-500/30";
        var msg_el = document.createElement("p");
        msg_el.className = "text-sm text-red-400";
        msg_el.textContent = String((e && e.message) || e);
        resultDetails.appendChild(msg_el);
      }
    });

    if (btnClear) {
      btnClear.addEventListener("click", function () {
        input.value = "";
        resultSection.classList.add("hidden");
        input.focus();
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();`;
export const VERIFY_JS_HASH = "ba919d83b7cc";
