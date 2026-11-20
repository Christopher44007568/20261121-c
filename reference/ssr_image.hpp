// Image I/O: binary PPM for easy inspection and a dependency-free PNG writer
// (zlib stored blocks, CRC/Adler implemented locally) for report artifacts.
#pragma once
#include <cstdint>
#include <string>
#include <vector>
#include <fstream>
#include <cstdio>

struct RGB { uint8_t r,g,b; };

inline bool writePPM(const std::string& path, const std::vector<RGB>& img,int W,int H){
    std::ofstream f(path,std::ios::binary);
    if(!f) return false;
    f<<"P6\n"<<W<<" "<<H<<"\n255\n";
    f.write(reinterpret_cast<const char*>(img.data()),img.size()*3);
    return (bool)f;
}

namespace png_detail {
inline uint32_t crcTable(){ return 0; }
inline uint32_t crc32(const uint8_t* p,size_t n,uint32_t crc=0xFFFFFFFFu){
    static uint32_t T[256]; static bool init=false;
    if(!init){ for(uint32_t i=0;i<256;++i){ uint32_t c=i; for(int k=0;k<8;++k) c=(c&1)?(0xEDB88320u^(c>>1)):(c>>1); T[i]=c;} init=true; }
    for(size_t i=0;i<n;++i) crc=T[(crc^p[i])&0xFF]^(crc>>8);
    return crc;
}
inline uint32_t adler32(const std::vector<uint8_t>& d){
    uint32_t a=1,b=0; const uint32_t MOD=65521;
    for(uint8_t x:d){ a=(a+x)%MOD; b=(b+a)%MOD; }
    return (b<<16)|a;
}
inline void put32(std::vector<uint8_t>& v,uint32_t x){ v.push_back(x>>24);v.push_back(x>>16);v.push_back(x>>8);v.push_back(x); }
inline void chunk(std::vector<uint8_t>& out,const char tag[4],const std::vector<uint8_t>& data){
    put32(out,(uint32_t)data.size());
    size_t start=out.size();
    out.insert(out.end(),tag,tag+4);
    out.insert(out.end(),data.begin(),data.end());
    uint32_t c=crc32(out.data()+start,4+data.size());
    put32(out,c^0xFFFFFFFFu);
}
}
inline bool writePNG(const std::string& path,const std::vector<RGB>& img,int W,int H){
    using namespace png_detail;
    std::vector<uint8_t> raw; raw.reserve((size_t)W*H*4);
    for(int y=0;y<H;++y){ raw.push_back(0);
        for(int x=0;x<W;++x){ const RGB& c=img[y*W+x]; raw.push_back(c.r);raw.push_back(c.g);raw.push_back(c.b);} }
    // zlib stream: stored blocks.
    std::vector<uint8_t> zlib{0x78,0x01};
    size_t pos=0;
    while(pos<raw.size()){
        size_t n=std::min((size_t)65535,raw.size()-pos);
        bool last=(pos+n==raw.size());
        zlib.push_back(last?1:0);
        zlib.push_back(n&0xFF); zlib.push_back((n>>8)&0xFF);
        zlib.push_back(~n&0xFF); zlib.push_back((~n>>8)&0xFF);
        zlib.insert(zlib.end(),raw.begin()+pos,raw.begin()+pos+n);
        pos+=n;
    }
    put32(zlib,adler32(raw));
    std::vector<uint8_t> out{0x89,'P','N','G',0x0D,0x0A,0x1A,0x0A};
    std::vector<uint8_t> ihdr;
    put32(ihdr,W); put32(ihdr,H);
    ihdr.push_back(8); ihdr.push_back(2); ihdr.push_back(0); ihdr.push_back(0); ihdr.push_back(0);
    chunk(out,"IHDR",ihdr);
    chunk(out,"IDAT",zlib);
    chunk(out,"IEND",{});
    std::ofstream f(path,std::ios::binary);
    if(!f) return false;
    f.write(reinterpret_cast<const char*>(out.data()),out.size());
    return (bool)f;
}
inline RGB toRGB(float3 c){
    auto g=[](float v){ v=std::max(0.0f,std::min(1.0f,v)); return (uint8_t)(std::pow(v,1.0f/2.2f)*255.0f+0.5f); };
    return {g(c.x),g(c.y),g(c.z)};
}
