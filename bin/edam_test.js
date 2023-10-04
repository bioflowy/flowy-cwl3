import path from 'path';
import { FormatGraph } from '../dist/formatgraph.js';
import { fileURLToPath, pathToFileURL } from 'url';
async function testEDam() {
  const dirname = path.dirname(fileURLToPath(import.meta.url));
  const url = path.join(dirname, '../work/tests/gx_edam.ttl');
  const edam = new FormatGraph(url);
  await edam.load();
  console.log(edam.isSubClassOf('http://galaxyproject.org/formats/fasta', 'http://edamontology.org/format_1929'));
  console.log(edam.isSubClassOf('http://edamontology.org/format_1929', 'http://galaxyproject.org/formats/fasta'));
}

testEDam()
  .then(() => {
    console.log('finished');
  })
  .catch((e) => {
    console.log(e);
  });
