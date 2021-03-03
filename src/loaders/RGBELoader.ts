import {
  DataTextureLoader,
  DataUtils,
  FloatType,
  HalfFloatType,
  LinearEncoding,
  LinearFilter,
  LoadingManager,
  NearestFilter,
  RGBEEncoding,
  RGBEFormat,
  RGBFormat,
  UnsignedByteType,
  TextureDataType,
  PixelFormat,
  TypedArray,
  DataTexture,
} from 'three'

// https://github.com/mrdoob/three.js/issues/5552
// http://en.wikipedia.org/wiki/RGBE_image_format

export interface RGBE {
  width: number
  height: number
  data: Float32Array | Uint8Array | Uint16Array
  header: string
  gamma: number
  exposure: number
  format: PixelFormat
  type: TextureDataType
}

class RGBELoader extends DataTextureLoader {
  type = UnsignedByteType

  constructor(manager?: LoadingManager) {
    super(manager)
  }

  // adapted from http://www.graphics.cornell.edu/~bjw/rgbe.html
  public parse = (buffer: ArrayBuffer): RGBE | null => {
    /* return codes for rgbe routines */
    //RGBE_RETURN_SUCCESS = 0,
    const RGBE_RETURN_FAILURE = -1
    /* default error routine.  change this to change error handling */
    const rgbe_read_error = 1
    const rgbe_write_error = 2
    const rgbe_format_error = 3
    const rgbe_memory_error = 4
    const rgbe_error = (rgbe_error_code: number, msg?: string) => {
      switch (rgbe_error_code) {
        case rgbe_read_error:
          console.error('THREE.RGBELoader Read Error: ' + (msg || ''))
          break
        case rgbe_write_error:
          console.error('THREE.RGBELoader Write Error: ' + (msg || ''))
          break
        case rgbe_format_error:
          console.error('THREE.RGBELoader Bad File Format: ' + (msg || ''))
          break
        default:
        case rgbe_memory_error:
          console.error('THREE.RGBELoader: Error: ' + (msg || ''))
      }

      return RGBE_RETURN_FAILURE
    }
    /* offsets to red, green, and blue components in a data (float) pixel */
    //RGBE_DATA_RED = 0,
    //RGBE_DATA_GREEN = 1,
    //RGBE_DATA_BLUE = 2,

    /* number of floats per pixel, use 4 since stored in rgba image format */
    //RGBE_DATA_SIZE = 4,

    /* flags indicating which fields in an rgbe_header_info are valid */
    const RGBE_VALID_PROGRAMTYPE = 1
    const RGBE_VALID_FORMAT = 2
    const RGBE_VALID_DIMENSIONS = 4
    const NEWLINE = '\n'

    const fgets = (buffer: Uint8Array, lineLimit?: number, consume?: boolean): string | false => {
      lineLimit = !lineLimit ? 1024 : lineLimit
      // @ts-expect-error i'm not sure if this an error or a TS error, but i can't find any evidence on Uint8Array supporting .pos
      let p = buffer.pos
      let i = -1
      let len = 0
      let s = ''
      const chunkSize = 128
      // @ts-ignore I'm not sure why this array needs to be typed, and i'm not going to solve it either
      let chunk = String.fromCharCode.apply(null, new Uint16Array(buffer.subarray(p, p + chunkSize)))
      while (0 > (i = chunk.indexOf(NEWLINE)) && len < lineLimit && p < buffer.byteLength) {
        s += chunk
        len += chunk.length
        p += chunkSize
        // @ts-ignore I'm not sure why this array needs to be typed, and i'm not going to solve it either
        chunk += String.fromCharCode.apply(null, new Uint16Array(buffer.subarray(p, p + chunkSize)))
      }

      if (-1 < i) {
        if (false !== consume) {
          // @ts-expect-error i'm not sure if this an error or a TS error, but i can't find any evidence on ArrayBuffer supporting .pos
          buffer.pos += len + i + 1
        }
        return s + chunk.slice(0, i)
      }

      return false
    }
    /* minimal header reading.  modify if you want to parse more information */
    const RGBE_ReadHeader = (buffer: Uint8Array) => {
      let line: string | false
      let match: RegExpMatchArray | null
      // regexes to parse header info fields
      const magic_token_re = /^#\?(\S+)/
      const gamma_re = /^\s*GAMMA\s*=\s*(\d+(\.\d+)?)\s*$/
      const exposure_re = /^\s*EXPOSURE\s*=\s*(\d+(\.\d+)?)\s*$/
      const format_re = /^\s*FORMAT=(\S+)\s*$/
      const dimensions_re = /^\s*\-Y\s+(\d+)\s+\+X\s+(\d+)\s*$/
      // RGBE format header struct
      const header = {
        valid: 0 /* indicate which fields are valid */,

        string: '' /* the actual header string */,

        comments: '' /* comments found in header */,

        programtype: 'RGBE' /* listed at beginning of file to identify it after "#?". defaults to "RGBE" */,

        format: '' /* RGBE format, default 32-bit_rle_rgbe */,

        gamma: 1.0 /* image has already been gamma corrected with given gamma. defaults to 1.0 (no correction) */,

        exposure: 1.0 /* a value of 1.0 in an image corresponds to <exposure> watts/steradian/m^2. defaults to 1.0 */,

        width: 0,
        height: 0 /* image dimensions, width/height */,
      }

      // @ts-expect-error i'm not sure if this an error or a TS error, but i can't find any evidence on Uint8Array supporting .pos
      if (buffer.pos >= buffer.byteLength || !(line = fgets(buffer))) {
        return rgbe_error(rgbe_read_error, 'no header found')
      }

      /* if you want to require the magic token then uncomment the next line */
      if (!(match = line.match(magic_token_re))) {
        return rgbe_error(rgbe_format_error, 'bad initial token')
      }

      header.valid |= RGBE_VALID_PROGRAMTYPE
      header.programtype = match[1]
      header.string += line + '\n'

      while (true) {
        line = fgets(buffer)
        if (false === line) break
        header.string += line + '\n'

        if ('#' === line.charAt(0)) {
          header.comments += line + '\n'
          continue // comment line
        }

        if ((match = line.match(gamma_re))) {
          header.gamma = parseFloat(match[1])
        }

        if ((match = line.match(exposure_re))) {
          header.exposure = parseFloat(match[1])
        }

        if ((match = line.match(format_re))) {
          header.valid |= RGBE_VALID_FORMAT
          header.format = match[1] //'32-bit_rle_rgbe';
        }

        if ((match = line.match(dimensions_re))) {
          header.valid |= RGBE_VALID_DIMENSIONS
          header.height = parseInt(match[1], 10)
          header.width = parseInt(match[2], 10)
        }

        if (header.valid & RGBE_VALID_FORMAT && header.valid & RGBE_VALID_DIMENSIONS) break
      }

      if (!(header.valid & RGBE_VALID_FORMAT)) {
        return rgbe_error(rgbe_format_error, 'missing format specifier')
      }

      if (!(header.valid & RGBE_VALID_DIMENSIONS)) {
        return rgbe_error(rgbe_format_error, 'missing image size specifier')
      }

      return header
    }

    const RGBE_ReadPixels_RLE = function (buffer: Uint8Array, w: number, h: number): number | Uint8Array {
      let data_rgba,
        offset,
        pos,
        count,
        byteValue,
        scanline_buffer,
        ptr,
        ptr_end,
        i,
        l,
        off,
        isEncodedRun,
        scanline_width = w,
        num_scanlines = h,
        rgbeStart

      if (
        // run length encoding is not allowed so read flat
        scanline_width < 8 ||
        scanline_width > 0x7fff ||
        // this file is not run length encoded
        2 !== buffer[0] ||
        2 !== buffer[1] ||
        buffer[2] & 0x80
      ) {
        // return the flat buffer
        return new Uint8Array(buffer)
      }

      if (scanline_width !== ((buffer[2] << 8) | buffer[3])) {
        return rgbe_error(rgbe_format_error, 'wrong scanline width')
      }

      data_rgba = new Uint8Array(4 * w * h)

      if (!data_rgba.length) {
        return rgbe_error(rgbe_memory_error, 'unable to allocate buffer space')
      }

      offset = 0
      pos = 0
      ptr_end = 4 * scanline_width
      rgbeStart = new Uint8Array(4)
      scanline_buffer = new Uint8Array(ptr_end)

      // read in each successive scanline
      while (num_scanlines > 0 && pos < buffer.byteLength) {
        if (pos + 4 > buffer.byteLength) {
          return rgbe_error(rgbe_read_error)
        }

        rgbeStart[0] = buffer[pos++]
        rgbeStart[1] = buffer[pos++]
        rgbeStart[2] = buffer[pos++]
        rgbeStart[3] = buffer[pos++]

        if (2 != rgbeStart[0] || 2 != rgbeStart[1] || ((rgbeStart[2] << 8) | rgbeStart[3]) != scanline_width) {
          return rgbe_error(rgbe_format_error, 'bad rgbe scanline format')
        }

        // read each of the four channels for the scanline into the buffer
        // first red, then green, then blue, then exponent
        ptr = 0
        while (ptr < ptr_end && pos < buffer.byteLength) {
          count = buffer[pos++]
          isEncodedRun = count > 128
          if (isEncodedRun) count -= 128

          if (0 === count || ptr + count > ptr_end) {
            return rgbe_error(rgbe_format_error, 'bad scanline data')
          }

          if (isEncodedRun) {
            // a (encoded) run of the same value
            byteValue = buffer[pos++]
            for (i = 0; i < count; i++) {
              scanline_buffer[ptr++] = byteValue
            }
            //ptr += count;
          } else {
            // a literal-run
            scanline_buffer.set(buffer.subarray(pos, pos + count), ptr)
            ptr += count
            pos += count
          }
        }

        // now convert data from buffer into rgba
        // first red, then green, then blue, then exponent (alpha)
        l = scanline_width //scanline_buffer.byteLength;
        for (i = 0; i < l; i++) {
          off = 0
          data_rgba[offset] = scanline_buffer[i + off]
          off += scanline_width //1;
          data_rgba[offset + 1] = scanline_buffer[i + off]
          off += scanline_width //1;
          data_rgba[offset + 2] = scanline_buffer[i + off]
          off += scanline_width //1;
          data_rgba[offset + 3] = scanline_buffer[i + off]
          offset += 4
        }

        num_scanlines--
      }

      return data_rgba
    }

    const RGBEByteToRGBFloat = (
      sourceArray: Uint8Array,
      sourceOffset: number,
      destArray: Float32Array,
      destOffset: number,
    ) => {
      const e = sourceArray[sourceOffset + 3]
      const scale = Math.pow(2.0, e - 128.0) / 255.0

      destArray[destOffset + 0] = sourceArray[sourceOffset + 0] * scale
      destArray[destOffset + 1] = sourceArray[sourceOffset + 1] * scale
      destArray[destOffset + 2] = sourceArray[sourceOffset + 2] * scale
    }

    const RGBEByteToRGBHalf = (
      sourceArray: Uint8Array,
      sourceOffset: number,
      destArray: Uint16Array,
      destOffset: number,
    ) => {
      const e = sourceArray[sourceOffset + 3]
      const scale = Math.pow(2.0, e - 128.0) / 255.0

      destArray[destOffset + 0] = DataUtils.toHalfFloat(sourceArray[sourceOffset + 0] * scale)
      destArray[destOffset + 1] = DataUtils.toHalfFloat(sourceArray[sourceOffset + 1] * scale)
      destArray[destOffset + 2] = DataUtils.toHalfFloat(sourceArray[sourceOffset + 2] * scale)
    }

    const byteArray = new Uint8Array(buffer)
    // @ts-expect-error i'm not sure if this an error or a TS error, but i can't find any evidence on Uint8Array supporting .pos
    byteArray.pos = 0
    const rgbe_header_info = RGBE_ReadHeader(byteArray)

    if (RGBE_RETURN_FAILURE !== rgbe_header_info && typeof rgbe_header_info !== 'number') {
      const w = rgbe_header_info.width,
        h = rgbe_header_info.height,
        // @ts-expect-error i'm not sure if this an error or a TS error, but i can't find any evidence on Uint8Array supporting .pos
        image_rgba_data = RGBE_ReadPixels_RLE(byteArray.subarray(byteArray.pos), w, h)

      let data: TypedArray = new Float32Array()
      let format: PixelFormat = RGBFormat
      let type: TextureDataType = this.type

      if (RGBE_RETURN_FAILURE !== image_rgba_data && typeof image_rgba_data !== 'number') {
        switch (this.type) {
          case UnsignedByteType:
            data = image_rgba_data
            format = RGBEFormat // handled as THREE.RGBAFormat in shaders
            type = UnsignedByteType
            break

          case FloatType:
            let numElements = (image_rgba_data.length / 4) * 3
            const floatArray = new Float32Array(numElements)

            for (let j = 0; j < numElements; j++) {
              RGBEByteToRGBFloat(image_rgba_data, j * 4, floatArray, j * 3)
            }

            data = floatArray
            format = RGBFormat
            type = FloatType
            break

          case HalfFloatType:
            numElements = (image_rgba_data.length / 4) * 3
            const halfArray = new Uint16Array(numElements)

            for (let j = 0; j < numElements; j++) {
              RGBEByteToRGBHalf(image_rgba_data, j * 4, halfArray, j * 3)
            }

            data = halfArray
            format = RGBFormat
            type = HalfFloatType
            break

          default:
            console.error('THREE.RGBELoader: unsupported type: ', this.type)
            break
        }

        return {
          width: w,
          height: h,
          data: data,
          header: rgbe_header_info.string,
          gamma: rgbe_header_info.gamma,
          exposure: rgbe_header_info.exposure,
          format: format,
          type: type,
        }
      }
    }

    return null
  }

  public setDataType = (value: TextureDataType): this => {
    this.type = value
    return this
  }

  public load = (
    url: string,
    onLoad: (dataTexture: DataTexture, texData: unknown) => void,
    onProgress?: (event: ProgressEvent) => void,
    onError?: (event: ErrorEvent) => void,
  ) => {
    function onLoadCallback(texture: DataTexture, texData: unknown) {
      switch (texture.type) {
        case UnsignedByteType:
          texture.encoding = RGBEEncoding
          texture.minFilter = NearestFilter
          texture.magFilter = NearestFilter
          texture.generateMipmaps = false
          texture.flipY = true
          break

        case FloatType:
          texture.encoding = LinearEncoding
          texture.minFilter = LinearFilter
          texture.magFilter = LinearFilter
          texture.generateMipmaps = false
          texture.flipY = true
          break

        case HalfFloatType:
          texture.encoding = LinearEncoding
          texture.minFilter = LinearFilter
          texture.magFilter = LinearFilter
          texture.generateMipmaps = false
          texture.flipY = true
          break
      }

      if (onLoad) {
        onLoad(texture, texData)
      }
    }

    // @ts-expect-error https://github.com/three-types/three-ts-types/issues/38
    return DataTextureLoader.prototype.load.call(this, url, onLoadCallback, onProgress, onError)
  }
}

export { RGBELoader }
