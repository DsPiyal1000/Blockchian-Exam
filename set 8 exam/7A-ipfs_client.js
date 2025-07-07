import { create } from 'ipfs-http-client';

const ipfs = create({ url: 'https://ipfs.infura.io:5001' });

const uploadFile = async (file) => {
  const result = await ipfs.add(file);
  return result.cid.toString();
};