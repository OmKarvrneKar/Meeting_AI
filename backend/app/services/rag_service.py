import os
import logging
from fastapi import UploadFile
from PyPDF2 import PdfReader
from langchain_community.vectorstores import Chroma
from langchain_openai import OpenAIEmbeddings
from langchain_text_splitters import RecursiveCharacterTextSplitter

logger = logging.getLogger(__name__)

class RAGService:
    def __init__(self):
        self.vector_store = None
        self.embeddings = None

    def initialize(self):
        if not self.embeddings:
            api_key = os.getenv("OPENAI_API_KEY")
            if api_key:
                self.embeddings = OpenAIEmbeddings(api_key=api_key)

    async def ingest_pdf(self, file: UploadFile):
        self.initialize()
        logger.info(f"Ingesting PDF: {file.filename}")
        reader = PdfReader(file.file)
        text = ""
        for page in reader.pages:
            page_text = page.extract_text()
            if page_text:
                text += page_text + "\n"
        
        if not text.strip():
            return 0

        splitter = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=200)
        chunks = splitter.split_text(text)
        
        self.vector_store = Chroma.from_texts(
            texts=chunks,
            embedding=self.embeddings,
            collection_name="meeting_context"
        )
        logger.info(f"Ingested {len(chunks)} chunks into vector store.")
        return len(chunks)

    def retrieve_context(self, query: str, k: int = 3) -> str:
        if not self.vector_store:
            return ""
        docs = self.vector_store.similarity_search(query, k=k)
        return "\n\n".join([doc.page_content for doc in docs])

rag_service = RAGService()
