import { Model } from './types';
export declare class PythonGenerator {
    private outputPath;
    constructor(outputPath: string);
    /**
     * Tên module metadata, lấy từ chính tên file cấu hình.
     *
     * Trước đây các import hardcode `an5_metadata` trong khi `outputPath` lại cấu
     * hình được, nên đặt `python.metadataFile` thành tên khác (ví dụ
     * `an5Metadata.py`) thì generator vẫn sinh `from an5_metadata import ...` và
     * client hỏng ngay khi import — lỗi chỉ lộ ra lúc chạy.
     */
    private metadataModule;
    generate(models: Model[]): void;
    private getPyFilterType;
    private generateOrmTypes;
    private generateMetadata;
    private mapPyType;
    private generateModelFile;
    private generateModelsIndex;
    private generateClient;
    private generateInit;
    private getAllPropertyVariations;
    private formatFields;
    private pyString;
    private toCamelCase;
    private toSnakeCase;
    private capitalize;
}
