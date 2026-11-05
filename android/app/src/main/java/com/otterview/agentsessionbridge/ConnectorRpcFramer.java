package com.otterview.agentsessionbridge;
import java.io.*;import java.nio.*;import java.util.*;
/** Stateful bounded binary framing; the caller must copy callback buffers first. */
final class ConnectorRpcFramer {
 static final int MAX_RECORD=2*1024*1024,MAX_CHUNK=16*1024;
 private final byte[] header=new byte[4];private int head,expected;private ByteArrayOutputStream body;
 synchronized List<byte[]> accept(byte[] chunk)throws Exception{if(chunk.length<1||chunk.length>MAX_CHUNK)throw new IOException("RPC chunk bound");List<byte[]> out=new ArrayList<>();int at=0;while(at<chunk.length){if(body==null){int n=Math.min(4-head,chunk.length-at);System.arraycopy(chunk,at,header,head,n);at+=n;head+=n;if(head<4)continue;expected=ByteBuffer.wrap(header).getInt();if(expected<1||expected>MAX_RECORD)throw new IOException("RPC record bound");body=new ByteArrayOutputStream(Math.min(expected,MAX_CHUNK));head=0;}int n=Math.min(expected-body.size(),chunk.length-at);body.write(chunk,at,n);at+=n;if(body.size()==expected){out.add(body.toByteArray());body=null;if(out.size()>32)throw new IOException("RPC record flood");}}return out;}
 static List<byte[]> encode(byte[] record)throws Exception{if(record.length<1||record.length>MAX_RECORD)throw new IOException("RPC record bound");byte[] framed=ByteBuffer.allocate(record.length+4).putInt(record.length).put(record).array();List<byte[]> chunks=new ArrayList<>();for(int at=0;at<framed.length;at+=MAX_CHUNK)chunks.add(Arrays.copyOfRange(framed,at,Math.min(at+MAX_CHUNK,framed.length)));return chunks;}
}
