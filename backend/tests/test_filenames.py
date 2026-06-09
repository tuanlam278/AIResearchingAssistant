from app.utils.filenames import storage_safe_filename


def test_storage_safe_filename_slugifies_vietnamese_name():
    assert storage_safe_filename("Tổng quan về Học máy và Ứng dụng.pdf") == "Tong-quan-ve-Hoc-may-va-Ung-dung.pdf"


def test_storage_safe_filename_removes_path_separators_and_unsafe_chars():
    assert storage_safe_filename("../bad\\name:*?.PDF") == "bad-name.pdf"
