import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import { PrefsFields } from './constants.js';

const FileQueryInfoFlags = Gio.FileQueryInfoFlags;
const FileCopyFlags = Gio.FileCopyFlags;
const FileTest = GLib.FileTest;

export default class Registry {
    constructor ({ settings, uuid }) {
        this.uuid = uuid;
        this.settings = settings;
        this.REGISTRY_FILE = 'registry.txt';
        this.REGISTRY_DIR = GLib.get_user_cache_dir() + '/' + this.uuid;
        this.REGISTRY_PATH = this.REGISTRY_DIR + '/' + this.REGISTRY_FILE;
        this.BACKUP_REGISTRY_PATH = this.REGISTRY_PATH + '~';
    }

    write (registry) {
        let json = JSON.stringify(registry);
        let contents = new GLib.Bytes(json);

        // Make sure dir exists
        GLib.mkdir_with_parents(this.REGISTRY_DIR, parseInt('0775', 8));

        // Write contents to file asynchronously
        let file = Gio.file_new_for_path(this.REGISTRY_PATH);
        file.replace_async(null, false, Gio.FileCreateFlags.NONE,
                            GLib.PRIORITY_DEFAULT, null, (obj, res) => {

            let stream = obj.replace_finish(res);

            stream.write_bytes_async(contents, GLib.PRIORITY_DEFAULT,
                                null, (w_obj, w_res) => {

                w_obj.write_bytes_finish(w_res);
                stream.close(null);
            });
        });
    }

    read (callback) {
        if (typeof callback !== 'function')
            throw TypeError('`callback` must be a function');

        if (GLib.file_test(this.REGISTRY_PATH, FileTest.EXISTS)) {
            let file = Gio.file_new_for_path(this.REGISTRY_PATH);
            let CACHE_FILE_SIZE = this.settings.get_int(PrefsFields.CACHE_FILE_SIZE);

            file.query_info_async('*', FileQueryInfoFlags.NONE,
                                  GLib.PRIORITY_DEFAULT, null, (src, res) => {
                // Check if file size is larger than CACHE_FILE_SIZE
                // If so, make a backup of file, and invoke callback with empty array
                let file_info = src.query_info_finish(res);

                if (file_info.get_size() >= CACHE_FILE_SIZE * 1024) {
                    let destination = Gio.file_new_for_path(this.BACKUP_REGISTRY_PATH);

                    file.move(destination, FileCopyFlags.OVERWRITE, null, null);
                    callback([]);
                    return;
                }

                file.load_contents_async(null, (obj, res) => {
                    let [success, contents] = obj.load_contents_finish(res);

                    if (success) {
                        let max_size = this.settings.get_int(PrefsFields.HISTORY_SIZE);
                        const registry = JSON.parse(new TextDecoder().decode(contents));

                        const clipboardEntries = registry.map(entry => {
                            return ClipboardEntry.fromJSON(entry);
                        });

                        let registryNoFavorite = clipboardEntries.filter(
                            entry => entry.isFavorite()
                        );

                        while (registryNoFavorite.length > max_size) {
                            let oldestNoFavorite = registryNoFavorite.shift();
                            let itemIdx = clipboardEntries.indexOf(oldestNoFavorite);
                            clipboardEntries.splice(itemIdx,1);

                            registryNoFavorite = clipboardEntries.filter(
                                entry => entry.isFavorite()
                            );
                        }

                        callback(clipboardEntries);
                    }
                    else {
                        log('Clipboard Indicator: failed to open registry file');
                    }
                });
            });
        }
        else {
            callback([]);
        }
    }
}

class ClipboardEntry {
    #mimetype;
    #bytes;
    #favorite;

    static fromJSON (entry) {
        const mimetype = entry.mimetype || 'text/plain';
        const bytes = new TextEncoder().encode(entry.contents);
        const favorite = entry.favorite;
        return new ClipboardEntry(mimetype, bytes, favorite);
    }

    constructor (mimetype, bytes, favorite) {
        this.#mimetype = mimetype;
        this.#bytes = bytes;
        this.#favorite = favorite;
    }

    toString () {
        return new TextDecoder().decode(this.#bytes);
    }

    isFavorite () {
        return this.#favorite;
    }
}
