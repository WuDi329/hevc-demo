class MP4Source {
  constructor(uri) {
    this.file = MP4Box.createFile();
    this.file.onError = console.error.bind(console);
    this.file.onReady = this.onReady.bind(this);
    this.file.onSamples = this.onSamples.bind(this);

    fetch(uri).then(response => {
      const reader = response.body.getReader();
      let offset = 0;
      let mp4File = this.file;

      function appendBuffers({done, value}) {
        if(done) {
          mp4File.flush();
          return;
        }

        let buf = value.buffer;
        buf.fileStart = offset;

        offset += buf.byteLength;

        mp4File.appendBuffer(buf);

        return reader.read().then(appendBuffers);
      }

      return reader.read().then(appendBuffers);
    })

    this.info = null;
    this._info_resolver = null;
  }

  onReady(info) {
    // TODO: Generate configuration changes.
    this.info = info;

    if (this._info_resolver) {
      this._info_resolver(info);
      this._info_resolver = null;
    }
  }

  getInfo() {
    if (this.info)
      return Promise.resolve(this.info);

    return new Promise((resolver) => { this._info_resolver = resolver; });
  }

  getHvccBox() {
    // TODO: make sure this is coming from the right track.
    console.log(this.file.moov.traks[0].mdia.minf.stbl.stsd.entries[0].hvcC)
    return this.file.moov.traks[0].mdia.minf.stbl.stsd.entries[0].hvcC
  }

  start(track, onChunk) {
    this._onChunk = onChunk;
    this.file.setExtractionOptions(track.id);
    this.file.start();
  }

  onSamples(track_id, ref, samples) {
    for (const sample of samples) {
      const type = sample.is_sync ? "key" : "delta";

      const chunk = new EncodedVideoChunk({
        type: type,
        timestamp: sample.cts,
        duration: sample.duration,
        data: sample.data
      });

      this._onChunk(chunk);
    }
  }
}

class Writer {
  constructor(size) {
    this.data = new Uint8Array(size);
    this.idx = 0;
    this.size = size;
  }

  getData() {
    if(this.idx != this.size)
      throw "Mismatch between size reserved and sized used"

    return this.data.slice(0, this.idx);
  }

  writeUint8(value) {
    this.data.set([value], this.idx);
    this.idx++;
  }

  writeUint16(value) {
    // TODO: find a more elegant solution to endianess.
    var arr = new Uint16Array(1);
    arr[0] = value;
    var buffer = new Uint8Array(arr.buffer);
    this.data.set([buffer[1], buffer[0]], this.idx);
    this.idx +=2;
  }

  writeUint32(value) {
    var arr = new Uint32Array(1);
    arr[0] = value;
    var buffer = new Uint8Array(arr.buffer);
    this.data.set([buffer[3], buffer[2], buffer[1], buffer[0]], this.idx);
    this.idx +=4;
  }

  writeUint8Array(value) {
    this.data.set(value, this.idx);
    this.idx += value.length;
  }
}

class MP4Demuxer {
  constructor(uri) {
    this.source = new MP4Source(uri);
  }

  getExtradata(hvccBox) {
    var i, j;
    var size = 23;
    for (i = 0; i < hvccBox.nalu_arrays.length; i++) {
      // nalu length is encoded as a uint16.
      size += 3;
      for (j = 0; j < hvccBox.nalu_arrays[i].length; j++){
        // console.log(hvccBox.nalu_arrays[i]["0"].data.length)
        size += (2+hvccBox.nalu_arrays[i][j].data.length)
      }
    }
    console.log(size)

    var writer = new Writer(size);

    writer.writeUint8(hvccBox.configurationVersion);
    console.log(((hvccBox.general_profile_space)<<6)+((hvccBox.general_tier_flag)<<5)+(hvccBox.general_profile_idc))
    writer.writeUint8(((hvccBox.general_profile_space)<<6)+((hvccBox.general_tier_flag)<<5)+(hvccBox.general_profile_idc));
    
    writer.writeUint32(hvccBox.general_profile_compatibility);
    writer.writeUint8Array(hvccBox.general_constraint_indicator);
    writer.writeUint8(hvccBox.general_level_idc);
    //考虑是小端序还是大端序
    
    //?
    writer.writeUint16((15<<24)+(hvccBox.min_spatial_segmentation_idc)); //???
    console.log((63<<2)+(hvccBox.parallelismType))
    writer.writeUint8((63<<2)+(hvccBox.parallelismType));
    writer.writeUint8((63<<2)+(hvccBox.chroma_format_idc));
    writer.writeUint8((31<<3)+(hvccBox.bit_depth_luma_minus8));
    writer.writeUint8((31<<3)+(hvccBox.bit_depth_chroma_minus8));
    writer.writeUint16(hvccBox.avgFrameRate);
    writer.writeUint8(((hvccBox.constantFrameRate)<<6)+(((hvccBox.numTemporalLayers))<<3)+((hvccBox.temporalIdNested)<<2)+(hvccBox.lengthSizeMinusOne))
    writer.writeUint8(hvccBox.nalu_arrays.length)
    for(i = 0; i < hvccBox.nalu_arrays.length; i++){
      let current = hvccBox.nalu_arrays[i]
      console.log(((current.completeness)<<7)+(current.nalu_type))
      writer.writeUint8(((current.completeness)<<7)+(current.nalu_type))

      writer.writeUint16(current.length)
      for(j = 0; j < current.length; j++){
        console.log(111111)
        console.log((current[j].data.length))
        writer.writeUint16(current[j].data.length)
        writer.writeUint8Array(current[j].data)
        console.log(22222)
      }
    }
    return writer.getData();
  }

  async getConfig() {
    let info = await this.source.getInfo();
    this.track = info.videoTracks[0];

    var extradata = this.getExtradata(this.source.getHvccBox());

    let config = {
      codec: this.track.codec,
      codedHeight: this.track.video.height,
      codedWidth: this.track.video.width,
      description: extradata,
    }
    console.log(config)

    return Promise.resolve(config);
  }

  start(onChunk) {
    this.source.start(this.track, onChunk);
  }
}
